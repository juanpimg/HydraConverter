import { useCallback, useRef, useState } from 'react';
import { WifiOff } from 'lucide-react';
import Dropzone from './components/Dropzone';
import Header from './components/Header';
import OptionsPanel from './components/OptionsPanel';
import Queue from './components/Queue';
import { convertAudio } from './converters/audio';
import { convertImage } from './converters/image';
import { convertVideo } from './converters/video';
import { useConvertStore } from './lib/store';
import { triggerDownload } from './utils/download';
import { createZipBlob } from './utils/zip';

export default function App() {
  // Los File originales viven aquí (el store solo guarda metadatos serializables).
  const fileMapRef = useRef(new Map<string, File>());
  // Ids cancelados por el usuario: el job en curso se descarta al terminar.
  const cancelledRef = useRef(new Set<string>());
  // Controladores de cancelación activa por cada job en ejecución.
  const abortControllersRef = useRef(new Map<string, AbortController>());
  // Ids en conversión ahora mismo: evita doble ejecución del mismo job.
  const runningRef = useRef(new Set<string>());
  const runningAllRef = useRef(false);
  const [runningAll, setRunningAll] = useState(false);

  const handleFilesAdded = useCallback((entries: Array<{ id: string; file: File }>) => {
    for (const { id, file } of entries) fileMapRef.current.set(id, file);
  }, []);

  const runJob = useCallback(async (id: string): Promise<void> => {
    if (runningRef.current.has(id)) return;
    const state = useConvertStore.getState();
    const job = state.jobs.find((j) => j.id === id);
    if (!job) return;
    const file = fileMapRef.current.get(id);
    if (!file) {
      state.updateJob(id, { status: 'error', message: 'Archivo no disponible en memoria.' });
      return;
    }
    if (job.kind === 'unknown') {
      state.updateJob(id, { status: 'error', message: 'Tipo de archivo no soportado.' });
      return;
    }
    // Conversión explícita: gana a una cancelación previa encolada.
    cancelledRef.current.delete(id);
    const controller = new AbortController();
    abortControllersRef.current.set(id, controller);
    runningRef.current.add(id);
    const started = performance.now();
    state.updateJob(id, { status: 'converting', progress: 0, message: 'Convirtiendo…', errorCode: undefined });
    try {
      const opts = useConvertStore.getState().options;
      const onProgress = (p: number): void => {
        useConvertStore.getState().updateJob(id, { progress: p });
      };
      let result: { blob: Blob; name: string; mime: string };
      if (job.kind === 'image') {
        const r = await convertImage(
          file,
          {
            format: opts.imageFormat === 'jpg' ? 'jpeg' : opts.imageFormat,
            quality: opts.imageQuality,
            maxWidth: opts.imageMaxWidth > 0 ? opts.imageMaxWidth : undefined,
          },
          onProgress,
          controller.signal,
        );
        result = { blob: r.blob, name: r.name, mime: r.mime };
      } else if (job.kind === 'audio') {
        const r = await convertAudio(
          file,
          {
            format: opts.audioFormat,
            sampleRate: opts.audioSampleRate,
            channels: opts.audioChannels,
            bitrate: opts.audioBitrate,
          },
          onProgress,
          controller.signal,
        );
        result = { blob: r.blob, name: r.name, mime: r.mime };
      } else {
        const r = await convertVideo(
          file,
          {
            format: opts.videoFormat,
            resolution: opts.videoResolution,
            fps: opts.videoFps,
            bitrate: opts.videoBitrate,
            includeAudio: opts.videoIncludeAudio,
          },
          onProgress,
          controller.signal,
        );
        result = { blob: r.blob, name: r.name, mime: r.mime };
      }
      const durationMs = Math.round(performance.now() - started);
      const store = useConvertStore.getState();
      // Si se canceló o eliminó durante la conversión, se descarta el resultado.
      if (controller.signal.aborted || cancelledRef.current.has(id)) {
        cancelledRef.current.delete(id);
        if (store.jobs.some((j) => j.id === id)) {
          store.updateJob(id, { status: 'queued', progress: 0, message: 'Cancelado' });
        }
        return;
      }
      if (!store.jobs.some((j) => j.id === id)) return;
      store.updateJob(id, {
        status: 'done',
        progress: 1,
        message: 'Listo',
        errorCode: undefined,
        outputBlob: result.blob,
        outputName: result.name,
        outputMime: result.mime,
        durationMs,
      });
    } catch (err) {
      const store = useConvertStore.getState();
      if (!store.jobs.some((j) => j.id === id)) return;
      const isAborted =
        controller.signal.aborted ||
        cancelledRef.current.has(id) ||
        (err instanceof DOMException && err.name === 'AbortError') ||
        (err instanceof Error && /cancelad|abort/i.test(err.message));
      if (isAborted) {
        cancelledRef.current.delete(id);
        store.updateJob(id, { status: 'queued', progress: 0, message: 'Cancelado' });
        return;
      }
      const rawMessage = err instanceof Error ? err.message : 'Error desconocido.';
      const H264_PREFIX = 'H264_NO_DISPONIBLE: ';
      if (rawMessage.startsWith(H264_PREFIX)) {
        const clean = rawMessage.slice(H264_PREFIX.length).trim() || 'H.264 no disponible.';
        store.updateJob(id, {
          status: 'error',
          errorCode: 'H264_UNAVAILABLE',
          message: `${clean} Prueba como WebM.`,
        });
      } else {
        store.updateJob(id, {
          status: 'error',
          errorCode: undefined,
          message: rawMessage,
        });
      }
    } finally {
      abortControllersRef.current.delete(id);
      runningRef.current.delete(id);
    }
  }, []);

  const runAll = useCallback(async (): Promise<void> => {
    if (runningAllRef.current) return;
    runningAllRef.current = true;
    setRunningAll(true);
    try {
      const seen = new Set<string>();
      for (;;) {
        const next = useConvertStore
          .getState()
          .jobs.find(
            (j) =>
              (j.status === 'queued' || j.status === 'error') &&
              !runningRef.current.has(j.id) &&
              !seen.has(j.id),
          );
        if (!next) break;
        seen.add(next.id);
        await runJob(next.id);
      }
    } finally {
      runningAllRef.current = false;
      setRunningAll(false);
    }
  }, [runJob]);

  const retryAsWebm = useCallback(
    (id: string) => {
      useConvertStore.getState().setOptions({ videoFormat: 'webm' });
      void runJob(id);
    },
    [runJob],
  );

  const handleCancel = useCallback((id: string) => {
    const job = useConvertStore.getState().jobs.find((j) => j.id === id);
    if (!job || job.status !== 'converting') return;
    cancelledRef.current.add(id);
    const controller = abortControllersRef.current.get(id);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(id);
    }
    useConvertStore.getState().updateJob(id, { message: 'Cancelando…' });
  }, []);

  const handleRemove = useCallback((id: string) => {
    // Marca cancelado para que un resultado en vuelo se descarte.
    cancelledRef.current.add(id);
    const controller = abortControllersRef.current.get(id);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(id);
    }
    fileMapRef.current.delete(id);
    useConvertStore.getState().removeJob(id);
  }, []);

  const handleClear = useCallback(() => {
    const { jobs, clearJobs } = useConvertStore.getState();
    for (const j of jobs) {
      cancelledRef.current.add(j.id);
      const controller = abortControllersRef.current.get(j.id);
      if (controller) controller.abort();
    }
    abortControllersRef.current.clear();
    fileMapRef.current.clear();
    clearJobs();
  }, []);

  const handleDownload = useCallback((id: string) => {
    const job = useConvertStore.getState().jobs.find((j) => j.id === id);
    if (job?.outputBlob && job.outputName) triggerDownload(job.outputBlob, job.outputName);
  }, []);

  const handleDownloadAll = useCallback(async () => {
    const { jobs } = useConvertStore.getState();
    const completed = jobs.filter((j) => j.status === 'done' && j.outputBlob && j.outputName);
    if (completed.length === 0) return;
    if (completed.length === 1) {
      triggerDownload(completed[0].outputBlob!, completed[0].outputName!);
      return;
    }
    const entries = completed.map((j) => ({
      name: j.outputName!,
      blob: j.outputBlob!,
    }));
    const zipBlob = await createZipBlob(entries);
    triggerDownload(zipBlob, `hydra-convert-${Date.now()}.zip`);
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <Header runningAll={runningAll} onConvertAll={() => void runAll()} onClear={handleClear} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <Dropzone onFilesAdded={handleFilesAdded} />
            <OptionsPanel />
          </div>
          <div className="min-w-0">
            <Queue
              onConvert={(id) => void runJob(id)}
              onRetryAsWebm={(id) => retryAsWebm(id)}
              onCancel={handleCancel}
              onRemove={handleRemove}
              onDownload={handleDownload}
              onDownloadAll={() => void handleDownloadAll()}
            />
          </div>
        </div>
      </main>

      <footer className="border-t border-zinc-800/80">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-center gap-2 px-4 py-3.5 text-center text-xs text-zinc-500">
          <WifiOff className="h-3.5 w-3.5 text-emerald-500/80" aria-hidden />
          <p>
            Procesamiento 100% local en tu dispositivo · Sin servidores · Sin límites de tamaño
          </p>
        </div>
      </footer>
    </div>
  );
}

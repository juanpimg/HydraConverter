import { useCallback, useRef, useState } from 'react';
import { Cpu, Image as ImageIcon, Layers, Music, Clapperboard, WifiOff } from 'lucide-react';
import Dropzone from './components/Dropzone';
import Header from './components/Header';
import OptionsPanel from './components/OptionsPanel';
import Queue from './components/Queue';
import { convertAudio } from './converters/audio';
import { convertImage } from './converters/image';
import { convertVideo } from './converters/video';
import { useConvertStore } from './lib/store';
import { triggerDownload } from './utils/download';

const STATS = [
  { icon: ImageIcon, title: 'Imagen', detail: '9 entradas → PNG · JPEG · WebP' },
  { icon: Music, title: 'Audio', detail: '8 entradas → WAV · WebM · M4A' },
  { icon: Clapperboard, title: 'Vídeo', detail: '5 entradas → MP4 · WebM · GIF · audio · frame' },
];

export default function App() {
  // Los File originales viven aquí (el store solo guarda metadatos serializables).
  const fileMapRef = useRef(new Map<string, File>());
  // Ids cancelados por el usuario: el job en curso se descarta al terminar.
  const cancelledRef = useRef(new Set<string>());
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
    runningRef.current.add(id);
    const started = performance.now();
    state.updateJob(id, { status: 'converting', progress: 0, message: 'Convirtiendo…' });
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
        );
        result = { blob: r.blob, name: r.name, mime: r.mime };
      }
      const durationMs = Math.round(performance.now() - started);
      const store = useConvertStore.getState();
      // Si se canceló o eliminó durante la conversión, se descarta el resultado
      // (no se crean object URL persistentes: nada que revocar).
      if (cancelledRef.current.has(id)) {
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
        outputBlob: result.blob,
        outputName: result.name,
        outputMime: result.mime,
        durationMs,
      });
    } catch (err) {
      const store = useConvertStore.getState();
      if (!store.jobs.some((j) => j.id === id)) return;
      if (cancelledRef.current.has(id)) {
        cancelledRef.current.delete(id);
        store.updateJob(id, { status: 'queued', progress: 0, message: 'Cancelado' });
        return;
      }
      store.updateJob(id, {
        status: 'error',
        message: err instanceof Error ? err.message : 'Error desconocido.',
      });
    } finally {
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

  const handleCancel = useCallback((id: string) => {
    const job = useConvertStore.getState().jobs.find((j) => j.id === id);
    if (!job || job.status !== 'converting') return;
    cancelledRef.current.add(id);
    useConvertStore.getState().updateJob(id, { message: 'Cancelando…' });
  }, []);

  const handleRemove = useCallback((id: string) => {
    // Marca cancelado para que un resultado en vuelo se descarte.
    // No hay object URL persistentes: el Blob se libera con el job.
    cancelledRef.current.add(id);
    fileMapRef.current.delete(id);
    useConvertStore.getState().removeJob(id);
  }, []);

  const handleClear = useCallback(() => {
    const { jobs, clearJobs } = useConvertStore.getState();
    for (const j of jobs) cancelledRef.current.add(j.id);
    fileMapRef.current.clear();
    clearJobs();
  }, []);

  const handleDownload = useCallback((id: string) => {
    const job = useConvertStore.getState().jobs.find((j) => j.id === id);
    if (job?.outputBlob && job.outputName) triggerDownload(job.outputBlob, job.outputName);
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Header runningAll={runningAll} onConvertAll={() => void runAll()} onClear={handleClear} />

      <main className="mx-auto w-full max-w-6xl px-4 pb-10">
        <section className="mt-4 rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-950 to-zinc-950 p-5 sm:p-6">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
            <Cpu className="h-3.5 w-3.5" aria-hidden />
            WebCodecs · Canvas · WebAudio — nada sale del navegador
          </div>
          <h2 className="mt-2 text-xl font-bold sm:text-2xl">
            Convierte vídeo, audio e imagen sin subir nada
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            Todo se procesa en tu dispositivo con APIs web estándar. Sin backend, sin cola en la
            nube, sin esperas de subida.
          </p>
          <dl className="mt-4 grid gap-2 sm:grid-cols-3">
            {STATS.map((s) => {
              const Icon = s.icon;
              return (
                <div
                  key={s.title}
                  className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2.5"
                >
                  <span className="rounded-lg bg-zinc-800 p-2 text-zinc-300" aria-hidden>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <dt className="text-xs font-semibold text-zinc-200">{s.title}</dt>
                    <dd className="truncate text-[11px] text-zinc-500">{s.detail}</dd>
                  </div>
                </div>
              );
            })}
          </dl>
        </section>

        <div className="mt-4 grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <Dropzone onFilesAdded={handleFilesAdded} />
            <OptionsPanel />
          </div>
          <div className="min-w-0">
            <Queue
              onConvert={(id) => void runJob(id)}
              onCancel={handleCancel}
              onRemove={handleRemove}
              onDownload={handleDownload}
            />
          </div>
        </div>

        <section className="mt-4 flex items-start gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-xs text-zinc-500">
          <Layers className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            Consejo: convierte por lotes con «Convertir todo». Los vídeos largos se procesan de
            forma secuencial para no saturar la memoria. Puedes cancelar cualquier conversión en
            curso.
          </p>
        </section>
      </main>

      <footer className="border-t border-zinc-800">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-center gap-2 px-4 py-4 text-center text-[11px] text-zinc-600">
          <WifiOff className="h-3.5 w-3.5" aria-hidden />
          <p>
            Funciona sin conexión tras la primera carga — ningún archivo sale de tu dispositivo.
          </p>
        </div>
      </footer>
    </div>
  );
}

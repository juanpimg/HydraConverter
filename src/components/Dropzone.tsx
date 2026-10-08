import { useRef, useState } from 'react';
import { ShieldCheck, UploadCloud } from 'lucide-react';
import { detectKindByMime, probeAudio, probeImage, probeVideo } from '../lib/detect';
import { useConvertStore } from '../lib/store';
import type { FileKind } from '../lib/types';

interface DropzoneProps {
  onFilesAdded: (entries: Array<{ id: string; file: File }>) => void;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '';
  const s = Math.round(totalSeconds);
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return m > 0 ? `${m}:${rest.toString().padStart(2, '0')}` : `${rest}s`;
}

/** Probe rápido solo informativo: dimensiones o duración en el mensaje del job. */
async function enrichWithProbe(id: string, file: File, kind: FileKind): Promise<void> {
  try {
    const { updateJob } = useConvertStore.getState();
    if (kind === 'image') {
      const p = await probeImage(file);
      updateJob(id, { message: `${p.width}×${p.height}` });
    } else if (kind === 'audio') {
      const p = await probeAudio(file);
      const d = formatDuration(p.duration);
      updateJob(id, { message: d ? `Duración ${d}` : 'Listo para convertir' });
    } else if (kind === 'video') {
      const p = await probeVideo(file);
      const d = formatDuration(p.duration);
      const dims = p.width > 0 ? `${p.width}×${p.height}` : '';
      updateJob(id, { message: [dims, d ? `· ${d}` : ''].join(' ').trim() || 'Listo para convertir' });
    }
  } catch {
    /* El probe es solo informativo: si falla, el job sigue en cola. */
  }
}

export default function Dropzone({ onFilesAdded }: DropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const dragCount = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (list: FileList | File[]) => {
    const files = Array.from(list).filter((f) => f.size > 0 || f.name.length > 0);
    if (files.length === 0) return;
    const { addJob } = useConvertStore.getState();
    const entries: Array<{ id: string; file: File }> = [];
    for (const file of files) {
      const id = newId();
      const kind = detectKindByMime(file.type, file.name);
      entries.push({ id, file });
      addJob({
        id,
        fileName: file.name || 'sin-nombre',
        fileSize: file.size,
        mime: file.type || 'application/octet-stream',
        kind,
        status: 'queued',
        progress: 0,
        message:
          kind === 'unknown' ? 'Tipo no reconocido: no se podrá convertir' : 'En cola',
      });
      void enrichWithProbe(id, file, kind);
    }
    onFilesAdded(entries);
  };

  return (
    <section
      id="dropzone"
      role="button"
      tabIndex={0}
      aria-label="Añadir archivos para convertir"
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        dragCount.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault();
        dragCount.current = Math.max(0, dragCount.current - 1);
        if (dragCount.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragCount.current = 0;
        setDragging(false);
        if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
      }}
      className={`cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition-colors sm:p-8 ${
        dragging
          ? 'border-emerald-500 bg-emerald-500/10'
          : 'border-zinc-700 bg-zinc-900/60 hover:border-zinc-500 hover:bg-zinc-900'
      }`}
    >
      <input
        id="file-input"
        ref={inputRef}
        type="file"
        multiple
        accept="video/*,audio/*,image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <UploadCloud
        className={`mx-auto h-10 w-10 ${dragging ? 'text-emerald-400' : 'text-zinc-500'}`}
        aria-hidden
      />
      <p className="mt-3 text-sm font-semibold text-zinc-100">
        {dragging ? 'Suelta los archivos aquí' : 'Arrastra archivos o haz clic para elegirlos'}
      </p>
      <p className="mt-1 text-xs text-zinc-500">Vídeo · Audio · Imagen — múltiples a la vez</p>
      <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] font-medium text-emerald-400">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        100% local — tus archivos nunca salen de este dispositivo
      </div>
    </section>
  );
}

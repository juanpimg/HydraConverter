import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  FileQuestion,
  Film,
  Image as ImageIcon,
  Inbox,
  Loader2,
  Music,
  Play,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useConvertStore } from '../lib/store';
import { formatBytes } from '../utils/formatBytes';
import type { ConvertJob, FileKind, JobStatus } from '../lib/types';

interface QueueProps {
  onConvert: (id: string) => void;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onDownload: (id: string) => void;
}

const KIND_ICON: Record<FileKind, LucideIcon> = {
  image: ImageIcon,
  audio: Music,
  video: Film,
  unknown: FileQuestion,
};

const STATUS_META: Record<JobStatus, { label: string; icon: LucideIcon; chip: string; spin?: boolean }> = {
  queued: { label: 'En cola', icon: Clock, chip: 'bg-zinc-800 text-zinc-300' },
  converting: { label: 'Convirtiendo', icon: Loader2, chip: 'bg-blue-600/20 text-blue-300', spin: true },
  done: { label: 'Listo', icon: CheckCircle2, chip: 'bg-emerald-600/20 text-emerald-300' },
  error: { label: 'Error', icon: AlertCircle, chip: 'bg-rose-600/20 text-rose-300' },
};

function iconButtonClass(disabled = false): string {
  return `rounded-lg p-1.5 transition-colors ${
    disabled
      ? 'cursor-not-allowed text-zinc-700'
      : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
  }`;
}

function JobRow({
  job,
  onConvert,
  onCancel,
  onRemove,
  onDownload,
}: {
  job: ConvertJob;
  onConvert: (id: string) => void;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onDownload: (id: string) => void;
}) {
  const KindIcon = KIND_ICON[job.kind];
  const meta = STATUS_META[job.status];
  const StatusIcon = meta.icon;
  const pct = Math.round(Math.min(1, Math.max(0, job.progress)) * 100);

  return (
    <li
      data-job-id={job.id}
      data-status={job.status}
      className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-lg bg-zinc-800 p-2 text-zinc-300" aria-hidden>
          <KindIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium text-zinc-100" title={job.fileName}>
              {job.fileName}
            </p>
            <span
              className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.chip}`}
            >
              <StatusIcon className={`h-3 w-3 ${meta.spin ? 'animate-spin' : ''}`} aria-hidden />
              {meta.label}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">
            {formatBytes(job.fileSize)}
            {job.durationMs !== undefined && job.status === 'done'
              ? ` · ${(job.durationMs / 1000).toFixed(1)}s`
              : null}
            {job.outputName && job.status === 'done' ? ` · ${job.outputName}` : null}
          </p>
          {job.message && (
            <p
              className={`mt-0.5 truncate text-xs ${job.status === 'error' ? 'text-rose-400' : 'text-zinc-500'}`}
              title={job.message}
            >
              {job.message}
            </p>
          )}
          {(job.status === 'converting' || (job.status === 'queued' && pct > 0)) && (
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-label={`Progreso de ${job.fileName}`}
            >
              <div
                className="job-progress-fill h-full rounded-full bg-emerald-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-end gap-1">
        {job.status === 'converting' && (
          <button
            type="button"
            data-action="cancel"
            title="Cancelar"
            aria-label={`Cancelar ${job.fileName}`}
            onClick={() => onCancel(job.id)}
            className={iconButtonClass()}
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {(job.status === 'queued' || job.status === 'error') && (
          <button
            type="button"
            data-action={job.status === 'error' ? 'retry' : 'convert'}
            title={job.status === 'error' ? 'Reintentar' : 'Convertir'}
            aria-label={`${job.status === 'error' ? 'Reintentar' : 'Convertir'} ${job.fileName}`}
            onClick={() => onConvert(job.id)}
            className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
          >
            {job.status === 'error' ? (
              <RotateCcw className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {job.status === 'error' ? 'Reintentar' : 'Convertir'}
          </button>
        )}
        {job.status === 'done' && job.outputBlob && (
          <button
            type="button"
            data-action="download"
            title="Descargar"
            aria-label={`Descargar ${job.outputName ?? job.fileName}`}
            onClick={() => onDownload(job.id)}
            className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
          >
            <Download className="h-3.5 w-3.5" />
            Descargar
          </button>
        )}
        <button
          type="button"
          data-action="remove"
          title="Eliminar"
          aria-label={`Eliminar ${job.fileName}`}
          onClick={() => onRemove(job.id)}
          className={iconButtonClass()}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

export default function Queue({ onConvert, onCancel, onRemove, onDownload }: QueueProps) {
  const jobs = useConvertStore((s) => s.jobs);

  return (
    <section
      id="queue"
      aria-label="Cola de conversión"
      className="flex min-h-[320px] flex-col rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-200">
          Cola{' '}
          <span className="ml-1 rounded-full bg-zinc-800 px-2 py-0.5 font-mono text-[11px] text-zinc-400">
            {jobs.length}
          </span>
        </h2>
      </div>

      {jobs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
          <Inbox className="h-8 w-8 text-zinc-700" aria-hidden />
          <p className="text-sm text-zinc-500">Sin archivos todavía</p>
          <p className="max-w-[260px] text-xs text-zinc-600">
            Añade vídeo, audio o imagen desde el panel izquierdo para empezar.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2 overflow-y-auto">
          {jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              onConvert={onConvert}
              onCancel={onCancel}
              onRemove={onRemove}
              onDownload={onDownload}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

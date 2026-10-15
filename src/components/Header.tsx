import { Github, Loader2, Play, Trash2, Zap } from 'lucide-react';
import { useConvertStore } from '../lib/store';

interface HeaderProps {
  runningAll: boolean;
  onConvertAll: () => void;
  onClear: () => void;
}

export default function Header({ runningAll, onConvertAll, onClear }: HeaderProps) {
  const jobs = useConvertStore((s) => s.jobs);
  const pending = jobs.filter((j) => j.status === 'queued' || j.status === 'error').length;

  return (
    <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3">
        <span className="rounded-xl bg-emerald-600 p-2 text-white" aria-hidden>
          <Zap className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold leading-tight text-zinc-100">
            Hydra Convert
          </h1>
          <p className="hidden text-[11px] text-zinc-400 sm:block">
            Conversor de vídeo, audio e imagen
          </p>
        </div>

        <a
          href="https://github.com/juanpimg/HydraConverter"
          target="_blank"
          rel="noopener noreferrer"
          title="Ver código en GitHub — ¡contribuye!"
          aria-label="Ver HydraConvert en GitHub (pestaña nueva)"
          className="hidden items-center gap-1.5 rounded-lg border border-zinc-700/80 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 sm:flex"
        >
          <Github className="h-3.5 w-3.5" aria-hidden />
          <span>GitHub</span>
        </a>

        <button
          id="clear-all"
          type="button"
          onClick={onClear}
          disabled={jobs.length === 0}
          title="Vaciar cola"
          aria-label="Vaciar cola de conversión"
          className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-zinc-700/80 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">Vaciar</span>
        </button>

        <button
          id="convert-all"
          type="button"
          onClick={onConvertAll}
          disabled={pending === 0 || runningAll}
          aria-busy={runningAll}
          title="Convertir todo"
          className="flex min-h-[36px] items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-zinc-950 transition-all hover:bg-emerald-400 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-emerald-500"
        >
          {runningAll ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
          )}
          <span>Convertir todo{pending > 0 ? ` (${pending})` : ''}</span>
        </button>
      </div>
    </header>
  );
}

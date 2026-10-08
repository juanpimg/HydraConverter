import { useState } from 'react';
import type { ReactNode } from 'react';
import { Clapperboard, Image as ImageIcon, Music, Settings2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useConvertStore } from '../lib/store';

type PanelTab = 'image' | 'audio' | 'video';

const TABS: Array<{ id: PanelTab; label: string; icon: LucideIcon }> = [
  { id: 'image', label: 'Imagen', icon: ImageIcon },
  { id: 'audio', label: 'Audio', icon: Music },
  { id: 'video', label: 'Vídeo', icon: Clapperboard },
];

const selectClass =
  'w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:border-emerald-500';

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="block">
      <span className="mb-1 flex items-baseline justify-between text-xs font-medium text-zinc-400">
        <span>{label}</span>
        {hint ? <span className="font-mono text-[11px] text-zinc-500">{hint}</span> : null}
      </span>
      {children}
    </div>
  );
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-zinc-900 p-1" role="group">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
              active ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const SAMPLE_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];
const AUDIO_BITRATES = [64000, 96000, 128000, 192000, 256000, 320000];

function formatKbps(bps: number): string {
  return `${Math.round(bps / 1000)} kbps`;
}

export default function OptionsPanel() {
  const jobs = useConvertStore((s) => s.jobs);
  const options = useConvertStore((s) => s.options);
  const setOptions = useConvertStore((s) => s.setOptions);
  const [manual, setManual] = useState<PanelTab | null>(null);

  const firstKind = jobs[0]?.kind;
  const active: PanelTab =
    manual ?? (firstKind === 'image' || firstKind === 'audio' || firstKind === 'video' ? firstKind : 'image');

  return (
    <section id="options-panel" className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Settings2 className="h-4 w-4 text-zinc-500" aria-hidden />
        <h2 className="text-sm font-semibold text-zinc-200">Opciones de salida</h2>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-1 rounded-xl bg-zinc-950 p-1" role="tablist" aria-label="Tipo de salida">
        {TABS.map((t) => {
          const Icon = t.icon;
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setManual(t.id)}
              className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
                selected ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>

      {active === 'image' && (
        <div className="flex flex-col gap-3" role="tabpanel">
          <Field label="Formato">
            <Segmented
              value={options.imageFormat}
              onChange={(v) => setOptions({ imageFormat: v })}
              options={[
                { value: 'png' as const, label: 'PNG' },
                { value: 'jpg' as const, label: 'JPEG' },
                { value: 'webp' as const, label: 'WebP' },
              ]}
            />
          </Field>
          <Field label="Calidad" hint={`${Math.round(options.imageQuality * 100)}%`}>
            <input
              type="range"
              min={10}
              max={100}
              step={1}
              value={Math.round(options.imageQuality * 100)}
              onChange={(e) => setOptions({ imageQuality: Number(e.target.value) / 100 })}
              className="w-full"
              aria-label="Calidad de imagen"
            />
          </Field>
          <Field label="Ancho máximo">
            <select
              value={options.imageMaxWidth}
              onChange={(e) => setOptions({ imageMaxWidth: Number(e.target.value) })}
              className={selectClass}
            >
              <option value={0}>Original</option>
              <option value={640}>640 px</option>
              <option value={960}>960 px</option>
              <option value={1280}>1280 px</option>
              <option value={1920}>1920 px</option>
              <option value={2560}>2560 px</option>
            </select>
          </Field>
        </div>
      )}

      {active === 'audio' && (
        <div className="flex flex-col gap-3" role="tabpanel">
          <Field label="Formato">
            <Segmented
              value={options.audioFormat}
              onChange={(v) => setOptions({ audioFormat: v })}
              options={[
                { value: 'wav' as const, label: 'WAV' },
                { value: 'webm' as const, label: 'WebM' },
                { value: 'mp4' as const, label: 'M4A' },
              ]}
            />
          </Field>
          <Field label="Frecuencia de muestreo">
            <select
              value={options.audioSampleRate}
              onChange={(e) => setOptions({ audioSampleRate: Number(e.target.value) })}
              className={selectClass}
            >
              {SAMPLE_RATES.map((r) => (
                <option key={r} value={r}>
                  {r.toLocaleString('es-ES')} Hz
                </option>
              ))}
            </select>
          </Field>
          <Field label="Canales">
            <Segmented
              value={options.audioChannels}
              onChange={(v) => setOptions({ audioChannels: v })}
              options={[
                { value: 1 as const, label: 'Mono' },
                { value: 2 as const, label: 'Estéreo' },
              ]}
            />
          </Field>
          <Field label="Bitrate">
            <select
              value={options.audioBitrate}
              onChange={(e) => setOptions({ audioBitrate: Number(e.target.value) })}
              className={selectClass}
            >
              {AUDIO_BITRATES.map((b) => (
                <option key={b} value={b}>
                  {formatKbps(b)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      {active === 'video' && (
        <div className="flex flex-col gap-3" role="tabpanel">
          <Field label="Formato">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { value: 'mp4', label: 'MP4' },
                  { value: 'webm', label: 'WebM' },
                  { value: 'gif', label: 'GIF' },
                  { value: 'mp3', label: 'MP3*' },
                  { value: 'wav', label: 'WAV' },
                  { value: 'png', label: 'PNG' },
                  { value: 'jpg', label: 'JPG' },
                ] as const
              ).map((o) => {
                const selected = options.videoFormat === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setOptions({ videoFormat: o.value })}
                    aria-pressed={selected}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      selected
                        ? 'bg-emerald-600 text-white'
                        : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </Field>
          <p className="-mt-1 text-[11px] text-zinc-500">
            * MP3 se entrega como .m4a (AAC): la web no tiene codificador MP3.
          </p>
          <Field label="Resolución">
            <select
              value={options.videoResolution}
              onChange={(e) =>
                setOptions({
                  videoResolution: e.target.value as typeof options.videoResolution,
                })
              }
              className={selectClass}
            >
              <option value="original">Original</option>
              <option value="360p">360p</option>
              <option value="480p">480p</option>
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
            </select>
          </Field>
          <Field label="Fotogramas por segundo">
            <Segmented
              value={options.videoFps}
              onChange={(v) => setOptions({ videoFps: v })}
              options={[
                { value: 24 as const, label: '24' },
                { value: 30 as const, label: '30' },
                { value: 60 as const, label: '60' },
              ]}
            />
          </Field>
          <Field label="Bitrate de vídeo" hint={`${(options.videoBitrate / 1_000_000).toFixed(1)} Mbps`}>
            <input
              type="range"
              min={500_000}
              max={20_000_000}
              step={500_000}
              value={options.videoBitrate}
              onChange={(e) => setOptions({ videoBitrate: Number(e.target.value) })}
              className="w-full"
              aria-label="Bitrate de vídeo"
            />
          </Field>
          <div>
            <span className="mb-1 block text-xs font-medium text-zinc-400">Pista de audio</span>
            <button
              type="button"
              role="checkbox"
              aria-checked={options.videoIncludeAudio}
              aria-label="Incluir audio del vídeo original"
              onClick={() => setOptions({ videoIncludeAudio: !options.videoIncludeAudio })}
              className="flex w-full items-center justify-between rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-sm"
            >
              <span className="text-zinc-200">Incluir audio</span>
              <span
                className={`relative h-5 w-9 rounded-full transition-colors ${
                  options.videoIncludeAudio ? 'bg-emerald-600' : 'bg-zinc-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                    options.videoIncludeAudio ? 'left-[18px]' : 'left-0.5'
                  }`}
                />
              </span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

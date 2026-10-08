/**
 * Conversor de audio 100% local, sin dependencias salvo `mp4-muxer`
 * (solo para la rama mp4/AAC/Opus) y APIs web estándar.
 *
 * - wav:  AudioContext.decodeAudioData -> OfflineAudioContext
 *         (resample/downmix) -> PCM16 manual (audioBufferToWavBlob).
 * - mp4:  igual que wav + AudioEncoder + Muxer mp4-muxer. AAC (mp4a.40.2)
 *         a 44.1 kHz con extensión `.m4a`; si no hay AAC operativo
 *         (p. ej. Firefox), respaldo Opus a 48 kHz en MP4 con extensión
 *         `.mp4`. Salida `audio/mp4` en ambos casos.
 * - webm: igual que wav (resample en memoria) + MediaRecorder
 *         (`audio/webm;codecs=opus`) con regrabado en tiempo real.
 */
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { audioBufferToWavBlob } from '../utils/wav-encoder';

export interface ConvertAudioOptions {
  format: 'wav' | 'webm' | 'mp4';
  sampleRate: number;
  channels: 1 | 2;
  bitrate: number;
}

export interface ConvertAudioResult {
  blob: Blob;
  mime: string;
  name: string;
}

/** Chunk AAC codificado, listo para muxar (lo produce encodeAudioBufferToAac). */
export interface AacChunk {
  chunk: EncodedAudioChunk;
  meta: EncodedAudioChunkMetadata | undefined;
}

/** Codecs de audio que mp4-muxer sabe muxar en MP4. */
export type AudioCodecName = 'aac' | 'opus';

/** Parámetros de codificación de encodeAudioBuffer. */
export interface EncodeAudioOptions {
  codec: AudioCodecName;
  sampleRate: number;
  channels: number;
  bitrate: number;
}

/** Resultado de encodeAudioBuffer: chunks listos para muxar + codec usado. */
export interface EncodedAudio {
  chunks: AacChunk[];
  codec: AudioCodecName;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot > 0) return fileName.slice(0, dot);
  return fileName || 'audio';
}

/**
 * Decodifica el archivo y lo renderiza al sampleRate / nº de canales
 * pedidos (resample + downmix/upmix vía OfflineAudioContext).
 * Informa 0.5 al decodificar y 1 al renderizar.
 */
async function decodeAndResample(
  file: File,
  sampleRate: number,
  channels: 1 | 2,
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
): Promise<AudioBuffer> {
  if (signal?.aborted) throw new DOMException('Operación cancelada', 'AbortError');
  const raw = await file.arrayBuffer();
  if (signal?.aborted) throw new DOMException('Operación cancelada', 'AbortError');
  const ctx = new AudioContext({ sampleRate });
  try {
    let decoded: AudioBuffer;
    try {
      // decodeAudioData transfiere (detaches) el buffer: se pasa una copia.
      decoded = await ctx.decodeAudioData(raw.slice(0));
    } catch {
      throw new Error('No se pudo decodificar el audio: el formato no es compatible con este navegador.');
    }
    if (signal?.aborted) throw new DOMException('Operación cancelada', 'AbortError');
    onProgress?.(0.5);
    const targetLength = Math.max(1, Math.floor(decoded.duration * sampleRate));
    const offline = new OfflineAudioContext(channels, targetLength, sampleRate);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start(0);
    const rendered = await offline.startRendering();
    if (signal?.aborted) throw new DOMException('Operación cancelada', 'AbortError');
    onProgress?.(1);
    return rendered;
  } finally {
    try {
      await ctx.close();
    } catch {
      /* el contexto ya estaba cerrado */
    }
  }
}

const AAC_SAMPLE_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];

/** AAC solo admite ciertos sample rates: se ajusta al más cercano. */
function snapAacSampleRate(requested: number): number {
  let best = 44100;
  for (const r of AAC_SAMPLE_RATES) {
    if (Math.abs(r - requested) < Math.abs(best - requested)) best = r;
  }
  return best;
}

const AUDIO_CODEC_LABELS: Record<AudioCodecName, string> = {
  aac: 'AAC (mp4a.40.2)',
  opus: 'Opus',
};

const AUDIO_CODEC_IDS: Record<AudioCodecName, string> = {
  aac: 'mp4a.40.2',
  opus: 'opus',
};

/**
 * Codifica un AudioBuffer (ya remuestreado) a chunks con AudioEncoder para
 * el codec pedido ('aac' | 'opus'). Los datos se entregan en planar float32
 * (`f32-planar`), en bloques de 2048 frames por canal, con timestamps en
 * microsegundos y duración explícita por chunk. Devuelve los chunks y el
 * codec realmente usado.
 */
export async function encodeAudioBuffer(
  buffer: AudioBuffer,
  opts: EncodeAudioOptions,
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
): Promise<EncodedAudio> {
  if (signal?.aborted) throw new DOMException('Operación cancelada', 'AbortError');
  const label = AUDIO_CODEC_LABELS[opts.codec];
  if (typeof AudioEncoder === 'undefined') {
    throw new Error(
      `Este navegador no soporta AudioEncoder (WebCodecs): no se puede codificar ${label}.`,
    );
  }
  const channels = Math.min(2, Math.max(1, Math.round(opts.channels)));
  const sampleRate = opts.sampleRate;
  const config: AudioEncoderConfig = {
    codec: AUDIO_CODEC_IDS[opts.codec],
    sampleRate,
    numberOfChannels: channels,
    bitrate: opts.bitrate,
  };
  let supported = false;
  try {
    supported = (await AudioEncoder.isConfigSupported(config)).supported === true;
  } catch {
    supported = false;
  }
  if (!supported) {
    throw new Error(
      `El codificador ${label} no es compatible con este navegador para esta configuración.`,
    );
  }

  const out: AacChunk[] = [];
  let encodeError: Error | null = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      out.push({ chunk, meta });
    },
    error: (e) => {
      encodeError = new Error(e.message || `Error del codificador ${label}.`);
    },
  });
  try {
    encoder.configure(config);
    const FRAMES_PER_CHUNK = 2048;
    const totalFrames = buffer.length;
    const planes: Float32Array[] = [];
    for (let c = 0; c < channels; c++) {
      planes.push(buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1)));
    }
    let timestamp = 0;
    for (let offset = 0; offset < totalFrames; offset += FRAMES_PER_CHUNK) {
      if (signal?.aborted) throw new DOMException('Operación cancelada', 'AbortError');
      if (encodeError) throw encodeError;
      const frames = Math.min(FRAMES_PER_CHUNK, totalFrames - offset);
      // Formato planar: los planos van concatenados (canal 0, canal 1, ...).
      const packed = new Float32Array(frames * channels);
      for (let c = 0; c < channels; c++) {
        packed.set(planes[c].subarray(offset, offset + frames), c * frames);
      }
      const duration = Math.max(1, Math.round((frames / sampleRate) * 1_000_000));
      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfChannels: channels,
        numberOfFrames: frames,
        timestamp,
        data: packed,
      });
      encoder.encode(audioData);
      audioData.close();
      timestamp += duration;
      onProgress?.(totalFrames === 0 ? 1 : (offset + frames) / totalFrames);
    }
    await encoder.flush();
    if (encodeError) throw encodeError;
    return { chunks: out, codec: opts.codec };
  } finally {
    if (encoder.state !== 'closed') {
      try {
        encoder.close();
      } catch {
        /* ya cerrado */
      }
    }
  }
}

/**
 * Compatibilidad: codifica un AudioBuffer a chunks AAC (mp4a.40.2).
 * Envoltorio de encodeAudioBuffer con codec 'aac'; firma y retorno intactos.
 */
export async function encodeAudioBufferToAac(
  buffer: AudioBuffer,
  opts: { sampleRate: number; channels: number; bitrate: number },
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
): Promise<AacChunk[]> {
  const { chunks } = await encodeAudioBuffer(buffer, { codec: 'aac', ...opts }, onProgress, signal);
  return chunks;
}

function pickWebmAudioMime(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm'];
  for (const candidate of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    } catch {
      /* probar siguiente */
    }
  }
  return undefined;
}

/**
 * Decodifica/remuestrea el archivo al sampleRate pedido, lo codifica con el
 * codec indicado y muxa los chunks en un MP4 (`audio/mp4`). Lanza si el
 * codec no está disponible o falla.
 */
async function encodeMp4Audio(
  file: File,
  codec: AudioCodecName,
  sampleRate: number,
  channels: 1 | 2,
  bitrate: number,
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const rendered = await decodeAndResample(
    file,
    sampleRate,
    channels,
    (p) => onProgress?.(0.05 + p * 0.25),
    signal,
  );
  if (signal?.aborted) throw new DOMException('Operación cancelada', 'AbortError');
  if (rendered.length === 0) throw new Error('El audio decodificado está vacío.');
  const { chunks } = await encodeAudioBuffer(
    rendered,
    { codec, sampleRate, channels, bitrate },
    (p) => onProgress?.(0.3 + p * 0.6),
    signal,
  );
  if (signal?.aborted) throw new DOMException('Operación cancelada', 'AbortError');
  onProgress?.(0.95);
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    audio: { codec, sampleRate, numberOfChannels: channels },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  for (const { chunk, meta } of chunks) muxer.addAudioChunk(chunk, meta);
  muxer.finalize();
  onProgress?.(1);
  return new Blob([target.buffer], { type: 'audio/mp4' });
}

export async function convertAudio(
  file: File,
  opts: ConvertAudioOptions,
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
): Promise<ConvertAudioResult> {
  if (signal?.aborted) throw new DOMException('Operación cancelada', 'AbortError');
  const base = baseName(file.name);
  onProgress?.(0.05);

  if (opts.format === 'wav') {
    const rendered = await decodeAndResample(
      file,
      opts.sampleRate,
      opts.channels,
      (p) => onProgress?.(0.05 + p * 0.85),
      signal,
    );
    if (signal?.aborted) throw new DOMException('Operación cancelada', 'AbortError');
    if (rendered.length === 0) throw new Error('El audio decodificado está vacío.');
    onProgress?.(0.95);
    const blob = audioBufferToWavBlob(rendered);
    onProgress?.(1);
    return { blob, mime: 'audio/wav', name: `${base}.wav` };
  }

  if (opts.format === 'mp4') {
    // AAC primero (compatibilidad máxima, extensión `.m4a`).
    let aacDetail = '';
    try {
      const blob = await encodeMp4Audio(
        file,
        'aac',
        snapAacSampleRate(opts.sampleRate),
        opts.channels,
        opts.bitrate,
        onProgress,
        signal,
      );
      return { blob, mime: 'audio/mp4', name: `${base}.m4a` };
    } catch (e) {
      if (signal?.aborted) throw e;
      aacDetail = e instanceof Error ? e.message : String(e);
    }
    // Respaldo: Opus a 48 kHz (óptimo) dentro de MP4 (p. ej. Firefox).
    try {
      const blob = await encodeMp4Audio(file, 'opus', 48000, opts.channels, opts.bitrate, onProgress, signal);
      return { blob, mime: 'audio/mp4', name: `${base}.mp4` };
    } catch (e) {
      if (signal?.aborted) throw e;
      const opusDetail = e instanceof Error ? e.message : String(e);
      throw new Error(
        `AUDIO_NO_DISPONIBLE: no se pudo codificar el audio para MP4. ` +
          `AAC: ${aacDetail} Opus: ${opusDetail}`,
      );
    }
  }

  // webm: regrabado en tiempo real del buffer ya remuestreado.
  const rendered = await decodeAndResample(
    file,
    opts.sampleRate,
    opts.channels,
    (p) => onProgress?.(0.05 + p * 0.2),
    signal,
  );
  if (signal?.aborted) throw new DOMException('Operación cancelada', 'AbortError');
  if (rendered.length === 0) throw new Error('El audio decodificado está vacío.');
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Este navegador no soporta MediaRecorder: no se puede codificar WebM.');
  }
  const ctx = new AudioContext();
  try {
    try {
      await ctx.resume();
    } catch {
      /* política de autoplay: se intenta igualmente */
    }
    const dest = ctx.createMediaStreamDestination();
    const src = ctx.createBufferSource();
    src.buffer = rendered;
    src.connect(dest);
    const mimeType = pickWebmAudioMime();
    const recorder = new MediaRecorder(
      dest.stream,
      mimeType ? { mimeType, audioBitsPerSecond: opts.bitrate } : { audioBitsPerSecond: opts.bitrate },
    );
    const parts: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) parts.push(event.data);
    };
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.start(250);
    src.start();
    const totalMs = Math.max(500, rendered.duration * 1000 + 300);
    const start = performance.now();
    for (;;) {
      if (signal?.aborted) {
        if (recorder.state !== 'inactive') recorder.stop();
        throw new DOMException('Operación cancelada', 'AbortError');
      }
      await sleep(100);
      const frac = Math.min(1, (performance.now() - start) / totalMs);
      onProgress?.(0.25 + frac * 0.7);
      if (frac >= 1) break;
    }
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
    const type = recorder.mimeType || 'audio/webm';
    onProgress?.(1);
    return { blob: new Blob(parts, { type }), mime: type, name: `${base}.webm` };
  } finally {
    try {
      await ctx.close();
    } catch {
      /* el contexto ya estaba cerrado */
    }
  }
}

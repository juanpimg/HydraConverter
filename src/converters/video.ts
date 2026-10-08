/**
 * Conversor de vídeo 100% local, sin dependencias salvo `mp4-muxer`
 * (rama mp4) y APIs web estándar (WebCodecs, Canvas, WebAudio,
 * MediaRecorder).
 *
 * - png/jpg: frame al 25% de la duración -> canvas -> toBlob.
 * - wav:     audio del vídeo -> WAV (reutiliza convertAudio).
 * - mp3:     la plataforma web no tiene codificador MP3; se genera
 *            AAC (`audio/mp4`) con extensión `.m4a`, reproducible en
 *            todos los reproductores (reutiliza convertAudio).
 * - mp4:     VideoEncoder (H.264) + AudioEncoder (AAC) + Muxer.
 * - webm:    canvas.captureStream + pista de audio (MediaElementSource)
 *            -> MediaRecorder (VP9/VP8 + Opus), grabación en tiempo real.
 * - gif:     muestreo de frames + codificador GIF89a inline mínimo
 *            (paleta global 3-3-2 de 256 colores, LZW propio, sin
 *            dithering, bucle infinito).
 */
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { convertAudio, encodeAudioBufferToAac, type AacChunk } from './audio';

export type VideoOutputFormat = 'mp4' | 'webm' | 'gif' | 'mp3' | 'wav' | 'png' | 'jpg';

export interface ConvertVideoOptions {
  format: VideoOutputFormat;
  resolution: string;
  fps: number;
  bitrate: number;
  includeAudio: boolean;
}

export interface ConvertVideoResult {
  blob: Blob;
  mime: string;
  name: string;
  width?: number;
  height?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot > 0) return fileName.slice(0, dot);
  return fileName || 'video';
}

function withExt(fileName: string, ext: string): string {
  return `${baseName(fileName)}${ext}`;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`El navegador no pudo codificar la imagen como ${type}.`));
      },
      type,
      quality,
    );
  });
}

/* ---------------- helpers de vídeo ---------------- */

interface LoadedVideo {
  video: HTMLVideoElement;
  url: string;
  width: number;
  height: number;
  duration: number;
}

function loadVideoElement(file: File): Promise<LoadedVideo> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      video.onloadedmetadata = null;
      video.onerror = null;
      resolve({
        video,
        url,
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
      });
    };
    video.onerror = () => {
      video.onloadedmetadata = null;
      video.onerror = null;
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer el vídeo: formato no compatible con este navegador.'));
    };
    video.src = url;
  });
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const target = Number.isFinite(time) ? Math.max(0, time) : 0;
    const onSeeked = (): void => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      resolve();
    };
    const onError = (): void => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      reject(new Error('Fallo al buscar una posición del vídeo.'));
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.currentTime = target;
  });
}

/** Dimensiones pares (exigencia de H.264); nunca amplía. */
function even(n: number): number {
  return Math.max(2, Math.round(n) & ~1);
}

function targetSize(w: number, h: number, resolution: string): { width: number; height: number } {
  const m = /^(\d+)p$/.exec(resolution.trim());
  if (!m) return { width: even(w), height: even(h) };
  const targetH = parseInt(m[1], 10);
  if (!Number.isFinite(targetH) || targetH <= 0 || h <= targetH) {
    return { width: even(w), height: even(h) };
  }
  const scale = targetH / h;
  return { width: even(w * scale), height: even(targetH) };
}

/** Espera a que la cola del encoder baje a <=3 (backpressure vía evento dequeue). */
function waitForDrain(encoder: VideoEncoder): Promise<void> {
  if (encoder.encodeQueueSize <= 3) return Promise.resolve();
  return new Promise((resolve) => {
    const check = (): void => {
      if (encoder.encodeQueueSize <= 3) {
        encoder.removeEventListener('dequeue', check);
        resolve();
      }
    };
    encoder.addEventListener('dequeue', check);
    check();
  });
}

/**
 * Candidatos H.264 ordenados de mayor a menor nivel: L5.2 cubre 4K60,
 * L4.0 cubre 1080p30; Baseline como último recurso (máxima compatibilidad).
 * `isConfigSupported` puede devolver `true` y aun así fallar la
 * inicialización real (p. ej. sin codificador H.264 disponible), por eso
 * cada candidato se valida con un `configure()` real sobre un encoder
 * temporal antes de usarlo en la conversión.
 */
const AVC_CANDIDATES = ['avc1.640034', 'avc1.640028', 'avc1.42001f', 'avc1.42001e'];
const ACCEL_CANDIDATES: HardwareAcceleration[] = ['prefer-hardware', 'prefer-software'];

interface AvcConfig {
  codec: string;
  hardwareAcceleration: HardwareAcceleration;
}

async function pickAvcConfig(
  width: number,
  height: number,
  bitrate: number,
  framerate: number,
): Promise<AvcConfig> {
  const safeBitrate = Math.max(100_000, Math.floor(bitrate) || 5_000_000);
  for (const codec of AVC_CANDIDATES) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate: safeBitrate,
        framerate,
      });
      if (!support.supported) continue;
    } catch {
      continue; // este candidato ni se anuncia: probar el siguiente
    }
    for (const hardwareAcceleration of ACCEL_CANDIDATES) {
      const probe = new VideoEncoder({ output: () => undefined, error: () => undefined });
      try {
        probe.configure({ codec, width, height, bitrate: safeBitrate, framerate, hardwareAcceleration });
        if (probe.state === 'configured') {
          return { codec, hardwareAcceleration };
        }
      } catch {
        /* configure() lanzó de forma síncrona: probar siguiente */
      } finally {
        try {
          probe.close();
        } catch {
          /* ya cerrado */
        }
      }
    }
  }
  throw new Error(
    'Este navegador no pudo inicializar el codificador H.264 con este vídeo ' +
      '(prueba con formato WebM o con una resolución menor).',
  );
}

/** Decodifica el audio del vídeo a estéreo 44.1kHz; null si no hay audio. */
async function decodeFileAudio(file: File): Promise<AudioBuffer | null> {
  try {
    const raw = await file.arrayBuffer();
    const ctx = new AudioContext({ sampleRate: 44100 });
    try {
      const decoded = await ctx.decodeAudioData(raw);
      const offline = new OfflineAudioContext(2, Math.max(1, Math.floor(decoded.duration * 44100)), 44100);
      const src = offline.createBufferSource();
      src.buffer = decoded;
      src.connect(offline.destination);
      src.start(0);
      return await offline.startRendering();
    } finally {
      try {
        await ctx.close();
      } catch {
        /* ya cerrado */
      }
    }
  } catch {
    return null;
  }
}

/* ---------------- png/jpg (frame único) ---------------- */

async function convertThumbnail(
  file: File,
  format: 'png' | 'jpg',
  onProgress?: (p: number) => void,
): Promise<ConvertVideoResult> {
  const loaded = await loadVideoElement(file);
  const { video, url } = loaded;
  try {
    if (loaded.width <= 0 || loaded.height <= 0) {
      throw new Error('No se pudieron leer las dimensiones del vídeo.');
    }
    onProgress?.(0.2);
    const t =
      Number.isFinite(loaded.duration) && loaded.duration > 0 ? loaded.duration * 0.25 : 0;
    await seekVideo(video, t);
    onProgress?.(0.5);
    const { width, height } = targetSize(loaded.width, loaded.height, 'original');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D no disponible en este navegador.');
    ctx.drawImage(video, 0, 0, width, height);
    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    const blob = await canvasToBlob(canvas, mime, 0.92);
    onProgress?.(1);
    return {
      blob,
      mime,
      name: withExt(file.name, format === 'png' ? '.png' : '.jpg'),
      width,
      height,
    };
  } finally {
    video.pause();
    URL.revokeObjectURL(url);
  }
}

/* ---------------- wav/mp3 (solo audio) ---------------- */

async function convertAudioOnly(
  file: File,
  format: 'mp3' | 'wav',
  bitrate: number,
  onProgress?: (p: number) => void,
): Promise<ConvertVideoResult> {
  if (format === 'wav') {
    const r = await convertAudio(
      file,
      { format: 'wav', sampleRate: 44100, channels: 2, bitrate },
      onProgress,
    );
    return { blob: r.blob, mime: r.mime, name: withExt(file.name, '.wav') };
  }
  // Sin codificador MP3 en la web: se entrega AAC (.m4a), compatible.
  const r = await convertAudio(
    file,
    { format: 'mp4', sampleRate: 44100, channels: 2, bitrate },
    onProgress,
  );
  return { blob: r.blob, mime: r.mime, name: withExt(file.name, '.m4a') };
}

/* ---------------- mp4 (H.264 + AAC) ---------------- */

async function convertToMp4(
  file: File,
  opts: ConvertVideoOptions,
  onProgress?: (p: number) => void,
): Promise<ConvertVideoResult> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    throw new Error('Este navegador no soporta WebCodecs (VideoEncoder): no se puede codificar MP4.');
  }
  const loaded = await loadVideoElement(file);
  const { video, url } = loaded;
  let videoEncoder: VideoEncoder | null = null;
  try {
    const duration = loaded.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('No se pudo determinar la duración del vídeo.');
    }
    if (loaded.width <= 0 || loaded.height <= 0) {
      throw new Error('No se pudieron leer las dimensiones del vídeo.');
    }
    const fps = opts.fps > 0 ? Math.floor(opts.fps) : 30;
    const { width: W, height: H } = targetSize(loaded.width, loaded.height, opts.resolution);
    const totalFrames = Math.max(1, Math.floor(duration * fps));
    const frameDurationUs = Math.max(1, Math.round(1_000_000 / fps));
    const safeBitrate = Math.max(100_000, Math.floor(opts.bitrate) || 5_000_000);
    onProgress?.(0.03);

    // Audio en paralelo conceptual: se decodifica/codifica antes del bucle de vídeo.
    let audioChunks: AacChunk[] = [];
    const audioSampleRate = 44100;
    const audioChannels = 2;
    if (opts.includeAudio) {
      const audioBuffer = await decodeFileAudio(file);
      if (audioBuffer && audioBuffer.length > 0) {
        try {
          audioChunks = await encodeAudioBufferToAac(
            audioBuffer,
            { sampleRate: audioSampleRate, channels: audioChannels, bitrate: 128_000 },
            (p) => onProgress?.(0.03 + p * 0.05),
          );
        } catch {
          audioChunks = []; // sin audio: se entrega solo vídeo
        }
      }
    }
    onProgress?.(0.08);

    const target = new ArrayBufferTarget();
    const muxer =
      audioChunks.length > 0
        ? new Muxer({
            target,
            video: { codec: 'avc', width: W, height: H, frameRate: fps },
            audio: { codec: 'aac', sampleRate: audioSampleRate, numberOfChannels: audioChannels },
            fastStart: 'in-memory',
            firstTimestampBehavior: 'offset',
          })
        : new Muxer({
            target,
            video: { codec: 'avc', width: W, height: H, frameRate: fps },
            fastStart: 'in-memory',
            firstTimestampBehavior: 'offset',
          });

    const avc = await pickAvcConfig(W, H, safeBitrate, fps);
    const videoChunks: { chunk: EncodedVideoChunk; meta: EncodedVideoChunkMetadata | undefined }[] =
      [];
    let encodeError: Error | null = null;
    videoEncoder = new VideoEncoder({
      output: (chunk, meta) => {
        videoChunks.push({ chunk, meta });
      },
      error: (e) => {
        if (!encodeError) {
          encodeError = new Error(
            (e.message || 'Error del codificador de vídeo.') +
              ' Prueba con formato WebM o con una resolución menor.',
          );
        }
      },
    });
    try {
      videoEncoder.configure({
        codec: avc.codec,
        width: W,
        height: H,
        bitrate: safeBitrate,
        framerate: fps,
        hardwareAcceleration: avc.hardwareAcceleration,
      });
    } catch (e) {
      throw new Error(
        `No se pudo configurar el codificador H.264 (${avc.codec}): ` +
          `${e instanceof Error ? e.message : 'error desconocido'}. ` +
          'Prueba con formato WebM o con una resolución menor.',
      );
    }
    if (videoEncoder.state !== 'configured') {
      throw new Error(
        'El codificador H.264 no quedó configurado. Prueba con formato WebM o con una resolución menor.',
      );
    }
    /** Lanza la causa REAL si el encoder murió de forma asíncrona. */
    const assertEncoderAlive = (): void => {
      if (encodeError) throw encodeError;
      if (!videoEncoder || videoEncoder.state !== 'configured') {
        throw new Error(
          'El codificador de vídeo se detuvo de forma inesperada. ' +
            'Prueba con formato WebM o con una resolución menor.',
        );
      }
    };

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D no disponible en este navegador.');

    for (let i = 0; i < totalFrames; i++) {
      assertEncoderAlive();
      const t = Math.min(i / fps, Math.max(0, duration - 0.05));
      await seekVideo(video, t);
      // El encoder puede morir durante el seek (callback de error asíncrono):
      // comprobar ANTES de encode() para no ver el críptico
      // "VideoEncoder.encode: Encoder must be configured first".
      assertEncoderAlive();
      ctx.drawImage(video, 0, 0, W, H);
      const timestamp = Math.round((i * 1_000_000) / fps);
      const frame = new VideoFrame(canvas, { timestamp, duration: frameDurationUs });
      try {
        try {
          videoEncoder.encode(frame, { keyFrame: i % 60 === 0 });
        } catch (e) {
          if (encodeError) throw encodeError;
          throw new Error(
            `Fallo al codificar el cuadro ${i + 1}/${totalFrames}: ` +
              `${e instanceof Error ? e.message : 'error desconocido'}. ` +
              'Prueba con formato WebM o con una resolución menor.',
          );
        }
      } finally {
        frame.close();
      }
      await waitForDrain(videoEncoder);
      onProgress?.(0.08 + (0.82 * (i + 1)) / totalFrames);
    }
    await videoEncoder.flush();
    assertEncoderAlive();

    for (const { chunk, meta } of videoChunks) muxer.addVideoChunk(chunk, meta);
    for (const { chunk, meta } of audioChunks) muxer.addAudioChunk(chunk, meta);
    muxer.finalize();
    onProgress?.(1);
    return {
      blob: new Blob([target.buffer], { type: 'video/mp4' }),
      mime: 'video/mp4',
      name: withExt(file.name, '.mp4'),
      width: W,
      height: H,
    };
  } finally {
    video.pause();
    if (videoEncoder && videoEncoder.state !== 'closed') {
      try {
        videoEncoder.close();
      } catch {
        /* ya cerrado */
      }
    }
    URL.revokeObjectURL(url);
  }
}

/* ---------------- webm (MediaRecorder en tiempo real) ---------------- */

function pickWebmVideoMime(): string | undefined {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const candidate of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    } catch {
      /* probar siguiente */
    }
  }
  return undefined;
}

async function convertToWebm(
  file: File,
  opts: ConvertVideoOptions,
  onProgress?: (p: number) => void,
): Promise<ConvertVideoResult> {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Este navegador no soporta MediaRecorder: no se puede codificar WebM.');
  }
  const loaded = await loadVideoElement(file);
  const { video, url } = loaded;
  let audioCtx: AudioContext | null = null;
  let rafId = 0;
  try {
    const duration = loaded.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('No se pudo determinar la duración del vídeo.');
    }
    if (loaded.width <= 0 || loaded.height <= 0) {
      throw new Error('No se pudieron leer las dimensiones del vídeo.');
    }
    const { width: W, height: H } = targetSize(loaded.width, loaded.height, opts.resolution);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D no disponible en este navegador.');

    const fps = Math.max(1, Math.floor(opts.fps) || 30);
    const canvasStream = canvas.captureStream(fps);

    let recordStream: MediaStream = canvasStream;
    if (opts.includeAudio) {
      try {
        audioCtx = new AudioContext();
        try {
          await audioCtx.resume();
        } catch {
          /* política de autoplay: se intenta igualmente */
        }
        const source = audioCtx.createMediaElementSource(video);
        const dest = audioCtx.createMediaStreamDestination();
        source.connect(dest);
        const audioTracks = dest.stream.getAudioTracks();
        if (audioTracks.length > 0) {
          recordStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
        }
        video.muted = false;
        video.volume = 1;
      } catch {
        recordStream = canvasStream;
        video.muted = true;
      }
    } else {
      video.muted = true;
    }

    const mimeType = pickWebmVideoMime();
    const recorder = new MediaRecorder(
      recordStream,
      mimeType
        ? { mimeType, videoBitsPerSecond: opts.bitrate, audioBitsPerSecond: 128_000 }
        : { videoBitsPerSecond: opts.bitrate },
    );
    const parts: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) parts.push(event.data);
    };
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });

    video.currentTime = 0;
    try {
      await video.play();
    } catch {
      // Autoplay bloqueado: se reintenta silenciado (el audio puede quedar en silencio).
      video.muted = true;
      await video.play();
    }

    let drawing = true;
    const draw = (): void => {
      if (!drawing) return;
      if (video.readyState >= 2) {
        try {
          ctx.drawImage(video, 0, 0, W, H);
        } catch {
          /* frame aún no listo */
        }
      }
      rafId = requestAnimationFrame(draw);
    };
    draw();
    recorder.start(250);
    onProgress?.(0.1);

    const totalMs = duration * 1000 + 1500;
    const start = performance.now();
    for (;;) {
      await sleep(100);
      const frac = Math.min(1, (performance.now() - start) / totalMs);
      onProgress?.(0.1 + frac * 0.85);
      if (video.ended || frac >= 1) break;
    }

    drawing = false;
    cancelAnimationFrame(rafId);
    video.pause();
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
    recordStream.getTracks().forEach((track) => track.stop());
    const type = recorder.mimeType || 'video/webm';
    onProgress?.(1);
    return {
      blob: new Blob(parts, { type }),
      mime: type,
      name: withExt(file.name, '.webm'),
      width: W,
      height: H,
    };
  } finally {
    cancelAnimationFrame(rafId);
    video.pause();
    if (audioCtx) {
      try {
        await audioCtx.close();
      } catch {
        /* ya cerrado */
      }
    }
    URL.revokeObjectURL(url);
  }
}

/* ---------------- gif (encoder inline mínimo) ---------------- */

/** Mapea RGBA a índices de paleta global 3-3-2 (256 colores, sin dithering). */
function mapTo332(data: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array((data.length / 4) | 0);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const r = Math.round((data[i] * 7) / 255);
    const g = Math.round((data[i + 1] * 7) / 255);
    const b = Math.round((data[i + 2] * 3) / 255);
    out[j] = ((r << 5) | (g << 2) | b) & 0xff;
  }
  return out;
}

/** Compresor LZW variante GIF (códigos LSB-first, clear + eoi). */
function lzwEncode(pixels: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const out: number[] = [];
  let bits = 0;
  let nbits = 0;
  const emit = (code: number, size: number): void => {
    bits |= code << nbits;
    nbits += size;
    while (nbits >= 8) {
      out.push(bits & 0xff);
      bits >>= 8;
      nbits -= 8;
    }
  };
  const flush = (): void => {
    if (nbits > 0) {
      out.push(bits & 0xff);
      bits = 0;
      nbits = 0;
    }
  };
  if (pixels.length === 0) {
    let codeSize = minCodeSize + 1;
    emit(clearCode, codeSize);
    emit(endCode, codeSize);
    codeSize = minCodeSize + 1;
    flush();
    return Uint8Array.from(out);
  }
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  const dict = new Map<number, number>();
  emit(clearCode, codeSize);
  let prefix = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i];
    const key = prefix * 256 + k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
    } else {
      emit(prefix, codeSize);
      if (nextCode > 4095) {
        // Tabla llena: clear y vuelta a empezar.
        emit(clearCode, codeSize);
        dict.clear();
        codeSize = minCodeSize + 1;
        nextCode = endCode + 1;
      } else {
        dict.set(key, nextCode);
        nextCode++;
        if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
      }
      prefix = k;
    }
  }
  emit(prefix, codeSize);
  emit(endCode, codeSize);
  flush();
  return Uint8Array.from(out);
}

function encodeGif89a(frames: Uint8Array[], width: number, height: number, delayCs: number): Blob {
  const bytes: number[] = [];
  const pushAscii = (s: string): void => {
    for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i) & 0xff);
  };
  const pushU16 = (n: number): void => {
    bytes.push(n & 0xff, (n >> 8) & 0xff);
  };

  pushAscii('GIF89a');
  pushU16(width);
  pushU16(height);
  bytes.push(0xf7, 0x00, 0x00); // GCT presente, 256 colores, fondo 0, aspecto 0
  for (let i = 0; i < 256; i++) {
    bytes.push(
      Math.round((((i >> 5) & 7) * 255) / 7),
      Math.round((((i >> 2) & 7) * 255) / 7),
      Math.round(((i & 3) * 255) / 3),
    );
  }
  // Extensión Netscape: bucle infinito.
  bytes.push(0x21, 0xff, 0x0b);
  pushAscii('NETSCAPE2.0');
  bytes.push(0x03, 0x01, 0x00, 0x00, 0x00);

  for (const indices of frames) {
    bytes.push(0x21, 0xf9, 0x04, 0x00); // GCE sin transparencia
    pushU16(delayCs);
    bytes.push(0x00, 0x00);
    bytes.push(0x2c, 0x00, 0x00, 0x00, 0x00); // descriptor: origen (0,0)
    pushU16(width);
    pushU16(height);
    bytes.push(0x00); // sin tabla local: usa la global
    const compressed = lzwEncode(indices, 8);
    bytes.push(0x08); // tamaño mínimo de código
    for (let o = 0; o < compressed.length; o += 255) {
      const n = Math.min(255, compressed.length - o);
      bytes.push(n);
      for (let k = 0; k < n; k++) bytes.push(compressed[o + k]);
    }
    bytes.push(0x00); // fin de sub-bloques
  }
  bytes.push(0x3b); // trailer
  return new Blob([Uint8Array.from(bytes)], { type: 'image/gif' });
}

async function convertToGif(
  file: File,
  opts: ConvertVideoOptions,
  onProgress?: (p: number) => void,
): Promise<ConvertVideoResult> {
  const loaded = await loadVideoElement(file);
  const { video, url } = loaded;
  try {
    const duration = loaded.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('No se pudo determinar la duración del vídeo.');
    }
    if (loaded.width <= 0 || loaded.height <= 0) {
      throw new Error('No se pudieron leer las dimensiones del vídeo.');
    }
    const sampleFps = Math.max(1, Math.min(10, Math.floor(opts.fps) || 10));
    const usable = Math.min(duration, 5); // máx. 5 s
    const count = Math.max(1, Math.min(60, Math.floor(usable * sampleFps)));
    const scale = loaded.width > 480 ? 480 / loaded.width : 1; // máx. 480 px de ancho
    const W = Math.max(1, Math.round(loaded.width * scale));
    const H = Math.max(1, Math.round(loaded.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D no disponible en este navegador.');

    const frames: Uint8Array[] = [];
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : Math.min(i / sampleFps, Math.max(0, duration - 0.05));
      await seekVideo(video, t);
      ctx.drawImage(video, 0, 0, W, H);
      frames.push(mapTo332(ctx.getImageData(0, 0, W, H).data));
      onProgress?.(0.05 + (0.85 * (i + 1)) / count);
    }
    const delayCs = Math.max(2, Math.round(100 / sampleFps));
    const blob = encodeGif89a(frames, W, H, delayCs);
    onProgress?.(1);
    return {
      blob,
      mime: 'image/gif',
      name: withExt(file.name, '.gif'),
      width: W,
      height: H,
    };
  } finally {
    video.pause();
    URL.revokeObjectURL(url);
  }
}

/* ---------------- dispatcher ---------------- */

export async function convertVideo(
  file: File,
  opts: ConvertVideoOptions,
  onProgress?: (p: number) => void,
): Promise<ConvertVideoResult> {
  switch (opts.format) {
    case 'png':
    case 'jpg':
      return convertThumbnail(file, opts.format, onProgress);
    case 'wav':
    case 'mp3':
      return convertAudioOnly(file, opts.format, opts.bitrate, onProgress);
    case 'mp4':
      return convertToMp4(file, opts, onProgress);
    case 'webm':
      return convertToWebm(file, opts, onProgress);
    case 'gif':
      return convertToGif(file, opts, onProgress);
    default:
      throw new Error('Formato de vídeo no soportado.');
  }
}

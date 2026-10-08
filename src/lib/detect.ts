import type { FileKind } from './types';

export function detectKindByMime(mime: string, fileName = ''): FileKind {
  const m = mime.toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  // Fallback by extension (empty/missing mime, e.g. some .mov/.ogv)
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif', 'ico'].includes(ext)) return 'image';
  if (['mp3', 'wav', 'ogg', 'oga', 'webm', 'm4a', 'aac', 'flac', 'opus'].includes(ext)) return 'audio';
  if (['mp4', 'mov', 'ogv', 'avi', 'mkv'].includes(ext)) return 'video';
  return 'unknown';
}

export interface ImageProbe {
  width: number;
  height: number;
}

export function probeImage(file: Blob): Promise<ImageProbe> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const result = { width: img.naturalWidth, height: img.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(result);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen'));
    };
    img.src = url;
  });
}

export interface AudioProbe {
  duration: number;
}

export function probeAudio(file: Blob): Promise<AudioProbe> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement('audio');
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      const duration = el.duration;
      URL.revokeObjectURL(url);
      resolve({ duration });
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer el audio'));
    };
    el.src = url;
  });
}

export interface VideoProbe {
  width: number;
  height: number;
  duration: number;
}

export function probeVideo(file: Blob): Promise<VideoProbe> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement('video');
    el.preload = 'metadata';
    el.muted = true;
    el.onloadedmetadata = () => {
      const result = {
        width: el.videoWidth,
        height: el.videoHeight,
        duration: el.duration,
      };
      URL.revokeObjectURL(url);
      resolve(result);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer el vídeo'));
    };
    el.src = url;
  });
}

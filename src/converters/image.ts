/**
 * Conversor de imágenes 100% local: createImageBitmap (fallback a <img>)
 * + canvas 2D + toBlob. Sin dependencias externas.
 */

export interface ConvertImageOptions {
  format: 'png' | 'jpeg' | 'webp';
  quality: number;
  maxWidth?: number;
  maxHeight?: number;
}

export interface ConvertImageResult {
  blob: Blob;
  mime: string;
  name: string;
  width: number;
  height: number;
}

const MIME_BY_FORMAT: Record<ConvertImageOptions['format'], string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

const EXT_BY_FORMAT: Record<ConvertImageOptions['format'], string> = {
  png: '.png',
  jpeg: '.jpg',
  webp: '.webp',
};

function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot > 0) return fileName.slice(0, dot);
  return fileName || 'imagen';
}

function clampQuality(q: number): number {
  if (!Number.isFinite(q)) return 0.92;
  return Math.min(1, Math.max(0, q));
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

interface DecodedImage {
  source: ImageBitmap | HTMLImageElement;
  bitmap: ImageBitmap | null;
  objectUrl: string | null;
  width: number;
  height: number;
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, bitmap, objectUrl: null, width: bitmap.width, height: bitmap.height };
    } catch {
      // Fallback a <img> (p. ej. SVG sin tamaño intrínseco).
    }
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () =>
        reject(new Error('No se pudo leer la imagen: formato no compatible con este navegador.'));
      el.src = objectUrl;
    });
    return { source: img, bitmap: null, objectUrl, width: img.naturalWidth, height: img.naturalHeight };
  } catch (err) {
    URL.revokeObjectURL(objectUrl);
    throw err;
  }
}

export async function convertImage(
  file: File,
  opts: ConvertImageOptions,
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
): Promise<ConvertImageResult> {
  if (signal?.aborted) throw new DOMException('Operación cancelada', 'AbortError');
  onProgress?.(0.05);
  const decoded = await decodeImage(file);
  try {
    if (signal?.aborted) throw new DOMException('Operación cancelada', 'AbortError');
    if (decoded.width <= 0 || decoded.height <= 0) {
      throw new Error('No se pudieron leer las dimensiones de la imagen.');
    }
    onProgress?.(0.3);

    // Escala manteniendo aspecto; nunca amplía salvo que se pida un
    // máximo mayor que el original (en cuyo caso scale se queda en 1).
    let scale = 1;
    if (opts.maxWidth !== undefined && opts.maxWidth > 0 && decoded.width > opts.maxWidth) {
      scale = Math.min(scale, opts.maxWidth / decoded.width);
    }
    if (opts.maxHeight !== undefined && opts.maxHeight > 0 && decoded.height > opts.maxHeight) {
      scale = Math.min(scale, opts.maxHeight / decoded.height);
    }
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D no disponible en este navegador.');
    ctx.drawImage(decoded.source, 0, 0, width, height);
    onProgress?.(0.7);

    if (signal?.aborted) throw new DOMException('Operación cancelada', 'AbortError');

    const mime = MIME_BY_FORMAT[opts.format];
    const quality = clampQuality(opts.quality);
    let blob: Blob;
    try {
      blob = await canvasToBlob(canvas, mime, quality);
    } catch (err) {
      // Fallback: si el navegador no codifica webp, entregar PNG en vez de fallar.
      if (opts.format !== 'webp') throw err;
      blob = await canvasToBlob(canvas, 'image/png', quality);
    }
    if (signal?.aborted) throw new DOMException('Operación cancelada', 'AbortError');
    onProgress?.(1);
    return {
      blob,
      mime: blob.type || mime,
      name: `${baseName(file.name)}${EXT_BY_FORMAT[opts.format]}`,
      width,
      height,
    };
  } finally {
    if (decoded.bitmap) decoded.bitmap.close();
    if (decoded.objectUrl) URL.revokeObjectURL(decoded.objectUrl);
  }
}

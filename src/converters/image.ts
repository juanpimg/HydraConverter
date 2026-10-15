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

function dataUrlToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Blob {
  const dataUrl = canvas.toDataURL(type, quality);
  const commaIdx = dataUrl.indexOf(',');
  const header = commaIdx >= 0 ? dataUrl.slice(0, commaIdx) : '';
  const match = header.match(/^data:([^;,]+)/);
  const resolvedType = match ? match[1] : type;
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: resolvedType });
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = 'image/png',
  quality = 0.92,
): Promise<Blob> {
  if (typeof canvas.toBlob === 'function') {
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              try {
                resolve(dataUrlToBlob(canvas, type, quality));
              } catch (err) {
                reject(
                  new Error(
                    `El navegador no pudo codificar la imagen como ${type}: ${err instanceof Error ? err.message : 'fallback toDataURL falló'}`,
                  ),
                );
              }
            }
          },
          type,
          quality,
        );
      } catch {
        try {
          resolve(dataUrlToBlob(canvas, type, quality));
        } catch (err) {
          reject(
            new Error(
              `El navegador no pudo codificar la imagen como ${type}: ${err instanceof Error ? err.message : 'fallback toDataURL falló'}`,
            ),
          );
        }
      }
    });
  }

  try {
    return Promise.resolve(dataUrlToBlob(canvas, type, quality));
  } catch (err) {
    return Promise.reject(
      new Error(
        `El navegador no pudo codificar la imagen como ${type}: ${err instanceof Error ? err.message : 'fallback toDataURL falló'}`,
      ),
    );
  }
}

interface DecodedImage {
  source: ImageBitmap | HTMLImageElement;
  bitmap: ImageBitmap | null;
  objectUrl: string | null;
  width: number;
  height: number;
}

async function decodeSvgImage(file: File): Promise<DecodedImage> {
  const text = await file.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) throw new Error('El archivo SVG no tiene un elemento <svg> válido.');

  let width = parseFloat(svgEl.getAttribute('width') || '0');
  let height = parseFloat(svgEl.getAttribute('height') || '0');

  if (width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) {
    const viewBox = svgEl.getAttribute('viewBox');
    if (viewBox) {
      const parts = viewBox.trim().split(/[\s,]+/).map(parseFloat);
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
        width = parts[2];
        height = parts[3];
      }
    }
  }
  if (width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) {
    width = 800;
    height = 800;
  }

  svgEl.setAttribute('width', String(width));
  svgEl.setAttribute('height', String(height));
  const serializer = new XMLSerializer();
  const modifiedSvg = serializer.serializeToString(doc);
  const blob = new Blob([modifiedSvg], { type: 'image/svg+xml' });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('No se pudo leer el archivo SVG.'));
      el.src = objectUrl;
    });
    return {
      source: img,
      bitmap: null,
      objectUrl,
      width: img.naturalWidth || width,
      height: img.naturalHeight || height,
    };
  } catch (err) {
    URL.revokeObjectURL(objectUrl);
    throw err;
  }
}

async function decodeImage(file: File): Promise<DecodedImage> {
  const isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
  if (isSvg) {
    try {
      return await decodeSvgImage(file);
    } catch {
      // Fallback a createImageBitmap / <img> estándar si falla el parser XML
    }
  }

  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width > 0 && bitmap.height > 0) {
        return { source: bitmap, bitmap, objectUrl: null, width: bitmap.width, height: bitmap.height };
      }
      bitmap.close();
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
    if (opts.format === 'jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
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

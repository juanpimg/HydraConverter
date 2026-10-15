import { describe, it, expect, vi } from 'vitest';
import { audioBufferToWavBlob } from '../utils/wav-encoder';
import { detectKindByMime } from '../lib/detect';
import { canvasToBlob as imageCanvasToBlob } from './image';
import {
  canvasToBlob as videoCanvasToBlob,
  convertVideo,
  convertThumbnail,
  convertToWebmWithMediaRecorder,
} from './video';
import { convertAudio } from './audio';
import {
  isWebmVideoSupported,
  isWebmAudioSupported,
  checkWebmVideoSupport,
  checkWebmAudioSupport,
} from '../components/OptionsPanel';

describe('converters and audio utilities', () => {
  it('audioBufferToWavBlob creates valid RIFF WAV with correct header structure', () => {
    // Simular AudioBuffer básico de 44.1kHz, 1 canal, 100 frames
    const sampleRate = 44100;
    const length = 100;
    const mockAudioBuffer = {
      sampleRate,
      numberOfChannels: 1,
      length,
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    } as unknown as AudioBuffer;

    const blob = audioBufferToWavBlob(mockAudioBuffer);
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + length * 2); // 44 bytes header + 200 bytes PCM16
  });

  it('detectKindByMime covers extended formats like opus, avif, ico, bmp, mov', () => {
    expect(detectKindByMime('', 'audio.opus')).toBe('audio');
    expect(detectKindByMime('', 'voice.m4a')).toBe('audio');
    expect(detectKindByMime('', 'icon.ico')).toBe('image');
    expect(detectKindByMime('', 'bitmap.bmp')).toBe('image');
    expect(detectKindByMime('', 'modern.avif')).toBe('image');
    expect(detectKindByMime('', 'clip.mov')).toBe('video');
    expect(detectKindByMime('', 'stream.ogv')).toBe('video');
  });

  it('detectKindByMime handles MIME types with parameters', () => {
    expect(detectKindByMime('audio/webm;codecs=opus')).toBe('audio');
    expect(detectKindByMime('video/webm;codecs=vp9,opus')).toBe('video');
    expect(detectKindByMime('image/svg+xml')).toBe('image');
  });

  it('canvasToBlob in image.ts and video.ts fallbacks to toDataURL when toBlob is undefined', async () => {
    // 1x1 transparent PNG base64
    const pngBase64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const mockCanvas = {
      toBlob: undefined,
      toDataURL: vi.fn().mockReturnValue(pngBase64),
    } as unknown as HTMLCanvasElement;

    // image.ts fallback
    const blob1 = await imageCanvasToBlob(mockCanvas, 'image/png', 0.92);
    expect(blob1).toBeInstanceOf(Blob);
    expect(blob1.type).toBe('image/png');
    expect(blob1.size).toBeGreaterThan(0);

    // Verify decoded content matches expected bytes
    const arrayBuffer = await blob1.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    expect(bytes[0]).toBe(0x89); // PNG magic byte
    expect(bytes[1]).toBe(0x50); // 'P'
    expect(bytes[2]).toBe(0x4e); // 'N'
    expect(bytes[3]).toBe(0x47); // 'G'

    // video.ts fallback
    const blob2 = await videoCanvasToBlob(mockCanvas, 'image/png', 0.92);
    expect(blob2).toBeInstanceOf(Blob);
    expect(blob2.type).toBe('image/png');
    expect(blob2.size).toBe(blob1.size);
  });

  it('canvasToBlob falls back to toDataURL when toBlob calls callback with null', async () => {
    const pngBase64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const mockCanvas = {
      toBlob: vi.fn((cb: (b: Blob | null) => void) => cb(null)),
      toDataURL: vi.fn().mockReturnValue(pngBase64),
    } as unknown as HTMLCanvasElement;

    const blob = await imageCanvasToBlob(mockCanvas, 'image/png', 0.92);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
  });

  it('canvasToBlob falls back to toDataURL when toBlob throws synchronously', async () => {
    const pngBase64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const mockCanvas = {
      toBlob: vi.fn(() => {
        throw new Error('TypeError: toBlob is not supported');
      }),
      toDataURL: vi.fn().mockReturnValue(pngBase64),
    } as unknown as HTMLCanvasElement;

    const blob = await imageCanvasToBlob(mockCanvas, 'image/png', 0.92);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
  });

  it('dataUrlToBlob extracts actual mime type from dataURL header when canvas falls back', async () => {
    // Canvas was asked for image/webp, but falls back to image/png per HTML spec
    const pngDataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const mockCanvas = {
      toBlob: undefined,
      toDataURL: vi.fn().mockReturnValue(pngDataUrl),
    } as unknown as HTMLCanvasElement;

    const blob = await imageCanvasToBlob(mockCanvas, 'image/webp', 0.92);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
  });

  it('canvasToBlob rejects with descriptive error if fallback fails', async () => {
    const brokenCanvas = {
      toBlob: undefined,
      toDataURL: vi.fn().mockImplementation(() => {
        throw new Error('SecurityError: tainted canvas');
      }),
    } as unknown as HTMLCanvasElement;

    await expect(imageCanvasToBlob(brokenCanvas, 'image/png', 0.92)).rejects.toThrow(
      /SecurityError: tainted canvas/,
    );
  });

  it('convertToMp4 throws error with H264_NO_DISPONIBLE: prefix in absence of WebCodecs', async () => {
    const dummyFile = new File(['dummy'], 'video.mp4', { type: 'video/mp4' });

    // En entorno Vitest/Node, VideoEncoder no existe globalmente
    await expect(
      convertVideo(dummyFile, {
        format: 'mp4',
        resolution: 'original',
        fps: 30,
        bitrate: 2_000_000,
        includeAudio: true,
      }),
    ).rejects.toThrow(/^H264_NO_DISPONIBLE:\s+/);
  });

  it('convertToMp4 throws H264_NO_DISPONIBLE: prefix if VideoFrame is undefined even with VideoEncoder present', async () => {
    const dummyFile = new File(['dummy'], 'video.mp4', { type: 'video/mp4' });

    // Simular VideoEncoder definido pero VideoFrame indefinido
    const originalVideoEncoder = (globalThis as unknown as { VideoEncoder?: unknown }).VideoEncoder;
    const originalVideoFrame = (globalThis as unknown as { VideoFrame?: unknown }).VideoFrame;
    try {
      (globalThis as unknown as { VideoEncoder: unknown }).VideoEncoder = class {};
      (globalThis as unknown as { VideoFrame: unknown }).VideoFrame = undefined;

      await expect(
        convertVideo(dummyFile, {
          format: 'mp4',
          resolution: 'original',
          fps: 30,
          bitrate: 2_000_000,
          includeAudio: true,
        }),
      ).rejects.toThrow(/^H264_NO_DISPONIBLE:\s+/);
    } finally {
      (globalThis as unknown as { VideoEncoder?: unknown }).VideoEncoder = originalVideoEncoder;
      (globalThis as unknown as { VideoFrame?: unknown }).VideoFrame = originalVideoFrame;
    }
  });

  it('convertToMp4 throws H264_NO_DISPONIBLE: prefix if VideoEncoder.isConfigSupported is missing', async () => {
    const dummyFile = new File(['dummy'], 'video.mp4', { type: 'video/mp4' });
    const originalVideoEncoder = (globalThis as unknown as { VideoEncoder?: unknown }).VideoEncoder;
    const originalVideoFrame = (globalThis as unknown as { VideoFrame?: unknown }).VideoFrame;
    try {
      (globalThis as unknown as { VideoEncoder: unknown }).VideoEncoder = class {}; // Sin isConfigSupported
      (globalThis as unknown as { VideoFrame: unknown }).VideoFrame = class {};

      await expect(
        convertVideo(dummyFile, {
          format: 'mp4',
          resolution: 'original',
          fps: 30,
          bitrate: 2_000_000,
          includeAudio: true,
        }),
      ).rejects.toThrow(/^H264_NO_DISPONIBLE:\s+/);
    } finally {
      (globalThis as unknown as { VideoEncoder?: unknown }).VideoEncoder = originalVideoEncoder;
      (globalThis as unknown as { VideoFrame?: unknown }).VideoFrame = originalVideoFrame;
    }
  });

  it('WebM capability checks export valid booleans based on environment', () => {
    expect(typeof isWebmVideoSupported).toBe('boolean');
    expect(typeof isWebmAudioSupported).toBe('boolean');
  });

  it('checkWebmVideoSupport detects support via VideoEncoder or MediaRecorder', () => {
    const originalVE = (globalThis as unknown as { VideoEncoder?: unknown }).VideoEncoder;
    const originalMR = (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder;
    try {
      // 1. Safari WebCodecs: VideoEncoder presente, MediaRecorder ausente
      (globalThis as unknown as { VideoEncoder: unknown }).VideoEncoder = class {};
      (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = undefined;
      expect(checkWebmVideoSupport()).toBe(true);

      // 2. Firefox tradicional: VideoEncoder ausente, MediaRecorder con VP9
      (globalThis as unknown as { VideoEncoder: unknown }).VideoEncoder = undefined;
      (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = {
        isTypeSupported: (type: string) => type.includes('video/webm;codecs=vp9'),
      };
      expect(checkWebmVideoSupport()).toBe(true);

      // 3. Ninguno soportado
      (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = {
        isTypeSupported: () => false,
      };
      expect(checkWebmVideoSupport()).toBe(false);

      (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = undefined;
      expect(checkWebmVideoSupport()).toBe(false);
    } finally {
      (globalThis as unknown as { VideoEncoder?: unknown }).VideoEncoder = originalVE;
      (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder = originalMR;
    }
  });

  it('checkWebmAudioSupport detects support via AudioEncoder or MediaRecorder', () => {
    const originalAE = (globalThis as unknown as { AudioEncoder?: unknown }).AudioEncoder;
    const originalMR = (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder;
    try {
      // 1. WebCodecs audio: AudioEncoder presente, MediaRecorder ausente
      (globalThis as unknown as { AudioEncoder: unknown }).AudioEncoder = class {};
      (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = undefined;
      expect(checkWebmAudioSupport()).toBe(true);

      // 2. MediaRecorder audio tradicional
      (globalThis as unknown as { AudioEncoder: unknown }).AudioEncoder = undefined;
      (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = {
        isTypeSupported: (type: string) => type.includes('audio/webm'),
      };
      expect(checkWebmAudioSupport()).toBe(true);

      // 3. Ninguno soportado
      (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = {
        isTypeSupported: () => false,
      };
      expect(checkWebmAudioSupport()).toBe(false);
    } finally {
      (globalThis as unknown as { AudioEncoder?: unknown }).AudioEncoder = originalAE;
      (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder = originalMR;
    }
  });

  it('convertToWebmWithMediaRecorder throws descriptive capability error when captureStream is missing', async () => {
    const dummyFile = new File(['dummy'], 'video.webm', { type: 'video/webm' });
    const originalMR = (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder;
    const originalDoc = (globalThis as unknown as { document?: unknown }).document;
    const originalURL = (globalThis as unknown as { URL?: unknown }).URL;
    try {
      (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = class {};
      const mockCanvas = {
        width: 100,
        height: 100,
        getContext: vi.fn().mockReturnValue({ drawImage: vi.fn() }),
        captureStream: undefined,
        mozCaptureStream: undefined,
        webkitCaptureStream: undefined,
      };
      const mockVideo = {
        videoWidth: 100,
        videoHeight: 100,
        duration: 1,
        onloadedmetadata: null as (() => void) | null,
        onerror: null as (() => void) | null,
        set src(_v: string) {
          setTimeout(() => {
            if (this.onloadedmetadata) this.onloadedmetadata();
          }, 0);
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        pause: vi.fn(),
      };
      (globalThis as unknown as { document: unknown }).document = {
        createElement: (tag: string) => (tag === 'video' ? mockVideo : mockCanvas),
      };
      (globalThis as unknown as { URL: unknown }).URL = {
        createObjectURL: vi.fn().mockReturnValue('blob:test'),
        revokeObjectURL: vi.fn(),
      };

      await expect(
        convertToWebmWithMediaRecorder(dummyFile, {
          format: 'webm',
          resolution: 'original',
          fps: 30,
          bitrate: 1_000_000,
          includeAudio: false,
        }),
      ).rejects.toThrow(/captureStream no disponible/);
    } finally {
      (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder = originalMR;
      (globalThis as unknown as { document?: unknown }).document = originalDoc;
      (globalThis as unknown as { URL?: unknown }).URL = originalURL;
    }
  });

  it('convertThumbnail fills white background on canvas for jpg format', async () => {
    const dummyFile = new File(['dummy'], 'clip.mp4', { type: 'video/mp4' });
    const originalDoc = (globalThis as unknown as { document?: unknown }).document;
    const originalURL = (globalThis as unknown as { URL?: unknown }).URL;
    try {
      let fillStyleApplied = '';
      let fillRectCalled = false;
      const mockCtx = {
        set fillStyle(val: string) {
          fillStyleApplied = val;
        },
        get fillStyle() {
          return fillStyleApplied;
        },
        fillRect: vi.fn(() => {
          fillRectCalled = true;
        }),
        drawImage: vi.fn(),
      };
      const mockCanvas = {
        width: 100,
        height: 100,
        getContext: vi.fn().mockReturnValue(mockCtx),
        toBlob: vi.fn((cb: (b: Blob) => void) => cb(new Blob(['jpg'], { type: 'image/jpeg' }))),
      };
      const listeners: Record<string, (() => void)[]> = {};
      const mockVideo = {
        videoWidth: 100,
        videoHeight: 100,
        duration: 1,
        onloadedmetadata: null as (() => void) | null,
        onerror: null as (() => void) | null,
        set src(_v: string) {
          setTimeout(() => {
            if (this.onloadedmetadata) this.onloadedmetadata();
          }, 0);
        },
        set currentTime(_t: number) {
          setTimeout(() => {
            (listeners['seeked'] || []).forEach((cb) => cb());
          }, 0);
        },
        addEventListener: (event: string, cb: () => void) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(cb);
        },
        removeEventListener: (event: string, cb: () => void) => {
          listeners[event] = (listeners[event] || []).filter((fn) => fn !== cb);
        },
        pause: vi.fn(),
      };
      (globalThis as unknown as { document: unknown }).document = {
        createElement: (tag: string) => (tag === 'video' ? mockVideo : mockCanvas),
      };
      (globalThis as unknown as { URL: unknown }).URL = {
        createObjectURL: vi.fn().mockReturnValue('blob:test'),
        revokeObjectURL: vi.fn(),
      };

      const res = await convertThumbnail(dummyFile, 'jpg');
      expect(fillStyleApplied).toBe('#ffffff');
      expect(fillRectCalled).toBe(true);
      expect(res.name).toBe('clip.jpg');
      expect(res.mime).toBe('image/jpeg');
    } finally {
      (globalThis as unknown as { document?: unknown }).document = originalDoc;
      (globalThis as unknown as { URL?: unknown }).URL = originalURL;
    }
  });

  it('convertAudio MediaRecorder fallback throws capability error if createMediaStreamDestination is missing', async () => {
    const dummyAudio = new File(['valid dummy audio'], 'audio.wav', { type: 'audio/wav' });
    const originalAE = (globalThis as unknown as { AudioEncoder?: unknown }).AudioEncoder;
    const originalMR = (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder;
    const originalAC = (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
    const originalOAC = (globalThis as unknown as { OfflineAudioContext?: unknown }).OfflineAudioContext;

    try {
      (globalThis as unknown as { AudioEncoder: unknown }).AudioEncoder = undefined;
      (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = class {};

      const mockBuffer = {
        sampleRate: 44100,
        numberOfChannels: 2,
        length: 4410,
        duration: 0.1,
        getChannelData: () => new Float32Array(4410),
      };

      class MockAudioContext {
        decodeAudioData(_buf: ArrayBuffer, successCb?: (b: unknown) => void) {
          if (successCb) successCb(mockBuffer);
          return Promise.resolve(mockBuffer);
        }
        createMediaStreamDestination = undefined; // Sin createMediaStreamDestination
        resume = vi.fn().mockResolvedValue(undefined);
        close = vi.fn().mockResolvedValue(undefined);
      }

      class MockOfflineAudioContext {
        destination = {};
        createBufferSource() {
          return {
            set buffer(_b: unknown) {},
            connect: vi.fn(),
            start: vi.fn(),
          };
        }
        startRendering() {
          return Promise.resolve(mockBuffer);
        }
      }

      (globalThis as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;
      (globalThis as unknown as { OfflineAudioContext: unknown }).OfflineAudioContext = MockOfflineAudioContext;

      await expect(
        convertAudio(dummyAudio, { format: 'webm', sampleRate: 44100, channels: 2, bitrate: 128000 }),
      ).rejects.toThrow(/createMediaStreamDestination no disponible/);
    } finally {
      (globalThis as unknown as { AudioEncoder?: unknown }).AudioEncoder = originalAE;
      (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder = originalMR;
      (globalThis as unknown as { AudioContext?: unknown }).AudioContext = originalAC;
      (globalThis as unknown as { OfflineAudioContext?: unknown }).OfflineAudioContext = originalOAC;
    }
  });

  it('convertAudio rejects when decoding invalid audio data in environment without AudioContext', async () => {
    const dummyAudio = new File(['not an audio'], 'test.wav', { type: 'audio/wav' });
    await expect(
      convertAudio(dummyAudio, { format: 'wav', sampleRate: 44100, channels: 2, bitrate: 128000 }),
    ).rejects.toThrow();
  });
});

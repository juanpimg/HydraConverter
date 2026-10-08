import { describe, it, expect } from 'vitest';
import { detectKindByMime } from './detect';

describe('detectKindByMime', () => {
  it('detects images from MIME types', () => {
    expect(detectKindByMime('image/png')).toBe('image');
    expect(detectKindByMime('image/jpeg')).toBe('image');
    expect(detectKindByMime('image/webp')).toBe('image');
  });

  it('detects audio from MIME types', () => {
    expect(detectKindByMime('audio/mpeg')).toBe('audio');
    expect(detectKindByMime('audio/wav')).toBe('audio');
    expect(detectKindByMime('audio/ogg')).toBe('audio');
  });

  it('detects video from MIME types', () => {
    expect(detectKindByMime('video/mp4')).toBe('video');
    expect(detectKindByMime('video/webm')).toBe('video');
    expect(detectKindByMime('video/quicktime')).toBe('video');
  });

  it('detects format by file extension fallback when MIME is empty', () => {
    expect(detectKindByMime('', 'video.mov')).toBe('video');
    expect(detectKindByMime('', 'track.flac')).toBe('audio');
    expect(detectKindByMime('', 'photo.avif')).toBe('image');
    expect(detectKindByMime('', 'doc.pdf')).toBe('unknown');
  });
});

import { describe, it, expect } from 'vitest';
import { crc32, createZipBlob } from './zip';

describe('ZIP utility', () => {
  it('calculates standard CRC32 correctly', () => {
    const encoder = new TextEncoder();
    const data = encoder.encode('123456789');
    // Standard check value for '123456789' is 0xCBF43926
    expect(crc32(data)).toBe(0xcbf43926);
  });

  it('creates valid ZIP archive with multiple entries', async () => {
    const file1 = new Blob(['Hello World!'], { type: 'text/plain' });
    const file2 = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'application/octet-stream' });

    const zipBlob = await createZipBlob([
      { name: 'hello.txt', blob: file1 },
      { name: 'data.bin', blob: file2 },
    ]);

    expect(zipBlob.type).toBe('application/zip');
    expect(zipBlob.size).toBeGreaterThan(0);

    const buffer = await zipBlob.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // ZIP starts with local file header signature 0x04034b50 (PK\x03\x04)
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K'
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);
  });
});

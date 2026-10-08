/**
 * Empaquetador ZIP 100% local, sin dependencias externas.
 * Produce archivos ZIP estándar (método 0 / Store) compatibles con
 * cualquier descompresor nativo (Windows Explorer, macOS Archive Utility, Linux, etc.).
 */

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c;
}

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  blob: Blob;
}

export async function createZipBlob(entries: ZipEntry[]): Promise<Blob> {
  const parts: BlobPart[] = [];
  const centralDirParts: Uint8Array[] = [];

  let currentOffset = 0;
  const encoder = new TextEncoder();

  // Fecha fija para determinismo y compatibilidad (2026-01-01 00:00:00 en formato MS-DOS)
  const dosTime = 0;
  const dosDate = (46 << 9) | (1 << 5) | 1;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const dataBuffer = await entry.blob.arrayBuffer();
    const dataBytes = new Uint8Array(dataBuffer);
    const checksum = crc32(dataBytes);
    const size = dataBytes.length;

    // 1. Local File Header (30 bytes) + filename + data
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);

    lv.setUint32(0, 0x04034b50, true); // Local file header signature
    lv.setUint16(4, 20, true); // Version needed to extract (2.0)
    lv.setUint16(6, 0x0800, true); // General purpose bit flag (UTF-8 filename)
    lv.setUint16(8, 0, true); // Compression method (0 = Store)
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, checksum, true);
    lv.setUint32(18, size, true); // Compressed size
    lv.setUint32(22, size, true); // Uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // Extra field length
    localHeader.set(nameBytes, 30);

    parts.push(localHeader);
    parts.push(dataBytes);

    // 2. Central Directory Header (46 bytes) + filename
    const cdHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cdHeader.buffer);

    cv.setUint32(0, 0x02014b50, true); // Central directory header signature
    cv.setUint16(4, 20, true); // Version made by
    cv.setUint16(6, 20, true); // Version needed to extract
    cv.setUint16(8, 0x0800, true); // Bit flag (UTF-8)
    cv.setUint16(10, 0, true); // Compression method (Store)
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, checksum, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); // Extra field length
    cv.setUint16(32, 0, true); // Comment length
    cv.setUint16(34, 0, true); // Disk number start
    cv.setUint16(36, 0, true); // Internal file attributes
    cv.setUint32(38, 0, true); // External file attributes
    cv.setUint32(42, currentOffset, true); // Relative offset of local header
    cdHeader.set(nameBytes, 46);

    centralDirParts.push(cdHeader);
    currentOffset += localHeader.length + size;
  }

  const centralDirOffset = currentOffset;
  let centralDirSize = 0;
  for (const c of centralDirParts) {
    parts.push(c.buffer as ArrayBuffer);
    centralDirSize += c.length;
  }

  // 3. End of Central Directory Record (22 bytes)
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);

  ev.setUint32(0, 0x06054b50, true); // EOCD signature
  ev.setUint16(4, 0, true); // Number of this disk
  ev.setUint16(6, 0, true); // Disk where central directory starts
  ev.setUint16(8, entries.length, true); // Number of central directory records on this disk
  ev.setUint16(10, entries.length, true); // Total number of central directory records
  ev.setUint32(12, centralDirSize, true); // Size of central directory
  ev.setUint32(16, centralDirOffset, true); // Offset of start of central directory
  ev.setUint16(20, 0, true); // Comment length

  parts.push(eocd.buffer as ArrayBuffer);

  return new Blob(parts, { type: 'application/zip' });
}

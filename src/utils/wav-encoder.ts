/**
 * Codificador WAV (PCM 16-bit) 100% local, sin dependencias.
 * Convierte un AudioBuffer ya renderizado en un Blob `audio/wav`
 * con cabecera RIFF de 44 bytes. No cierra nada: el buffer de
 * entrada se puede seguir usando.
 */
export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numberOfChannels = buffer.numberOfChannels;
  const sampleRate = Math.round(buffer.sampleRate);
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numberOfChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const frameCount = buffer.length;
  const dataSize = frameCount * blockAlign;

  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);

  const writeAscii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // tamaño del sub-chunk fmt (PCM)
  view.setUint16(20, 1, true); // audioFormat = 1 (PCM)
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numberOfChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < frameCount; i++) {
    for (let c = 0; c < numberOfChannels; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
      offset += 2;
    }
  }

  return new Blob([ab], { type: 'audio/wav' });
}

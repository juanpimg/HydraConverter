export type FileKind = 'image' | 'audio' | 'video' | 'unknown';

export type JobStatus = 'queued' | 'converting' | 'done' | 'error';

export interface ConvertJob {
  id: string;
  fileName: string;
  fileSize: number;
  mime: string;
  kind: FileKind;
  status: JobStatus;
  progress: number;
  message: string;
  outputBlob?: Blob;
  outputName?: string;
  outputMime?: string;
  durationMs?: number;
  errorCode?: 'H264_UNAVAILABLE' | undefined;
}

export interface OutputOptions {
  imageFormat: 'png' | 'jpg' | 'webp';
  imageQuality: number;
  imageMaxWidth: number;
  audioFormat: 'wav' | 'webm' | 'mp4';
  audioSampleRate: number;
  audioChannels: 1 | 2;
  audioBitrate: number;
  videoFormat: 'mp4' | 'webm' | 'gif' | 'mp3' | 'wav' | 'png' | 'jpg';
  videoResolution: '360p' | '480p' | '720p' | '1080p' | 'original';
  videoFps: 24 | 30 | 60;
  videoBitrate: number;
  videoIncludeAudio: boolean;
}

export const DEFAULT_OUTPUT_OPTIONS: OutputOptions = {
  imageFormat: 'webp',
  imageQuality: 0.92,
  imageMaxWidth: 0,
  audioFormat: 'wav',
  audioSampleRate: 44100,
  audioChannels: 2,
  audioBitrate: 128_000,
  videoFormat: 'mp4',
  videoResolution: 'original',
  videoFps: 30,
  videoBitrate: 5_000_000,
  videoIncludeAudio: true,
};

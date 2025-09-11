import { z } from 'zod';

export const AudioWindowUploadSchema = z.object({
  sessionId: z.string().min(1),
  groupId: z.string().min(1),
  chunkId: z.string().min(8),
  startTs: z.coerce.number().int().nonnegative(),
  endTs: z.coerce.number().int().positive(),
});

export type AudioWindowUpload = z.infer<typeof AudioWindowUploadSchema>;

export const SupportedAudioMimes = [
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/mpga',
];

export function isSupportedAudioMime(mime?: string | null): boolean {
  if (!mime) return false;
  const m = mime.toLowerCase();
  return SupportedAudioMimes.some((s) => m.startsWith(s));
}


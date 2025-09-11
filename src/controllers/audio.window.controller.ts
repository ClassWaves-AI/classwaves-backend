import type { Request, Response } from 'express';
import multer from 'multer';
import * as client from 'prom-client';
import { AudioWindowUploadSchema, isSupportedAudioMime } from '../utils/zod-schemas/audio-upload.schema';
import { redisService } from '../services/redis.service';

// Lazy import bullmq to allow tests to mock easily
type BullQueue = { add: (name: string, data: any, opts?: any) => Promise<{ id?: string }> };

// Metrics (guard against duplicate registration)
function getCounter(name: string, help: string, labelNames?: string[]) {
  const existing = client.register.getSingleMetric(name) as client.Counter<string> | undefined;
  if (existing) return existing;
  return new client.Counter({ name, help, ...(labelNames ? { labelNames } : {}) });
}
function getHistogram(name: string, help: string, buckets: number[], labelNames?: string[]) {
  const existing = client.register.getSingleMetric(name) as client.Histogram<string> | undefined;
  if (existing) return existing;
  return new client.Histogram({ name, help, buckets, ...(labelNames ? { labelNames } : {}) });
}

const audioUploadTotal = getCounter('audio_upload_request_total', 'Total audio window upload requests');
const audioDedupHitTotal = getCounter('audio_dedup_hit_total', 'Total dedupe hits for audio windows');
const sttJobsQueuedTotal = getCounter('stt_jobs_queued_total', 'Total STT jobs queued');
const uploadBytesHistogram = getHistogram('audio_upload_window_bytes', 'Uploaded window size (bytes)', [8e3, 3.2e4, 1.28e5, 5.12e5, 2.0e6]);

// Multer config (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.AUDIO_UPLOAD_MAX_BYTES || String(5 * 1024 * 1024), 10),
  },
});

export const audioUploadMulter = upload.single('audio');

export async function processAudioWindow(input: { sessionId: string; groupId: string; chunkId: string; startTs: number; endTs: number; file: { buffer: Buffer; mimetype: string }; traceId?: string }) {
  const { sessionId, groupId, chunkId, startTs, endTs, file, traceId } = input;
  const receivedAt = Date.now();
  const mime = file.mimetype || 'application/octet-stream';
  const bytes = file.buffer.length;

  // Deduplicate by chunkId (24h TTL)
  const dedupKey = `dedup:audio:chunk:${chunkId}`;
  try {
    const result = await (redisService.getClient() as any).set(dedupKey, '1', 'EX', 24 * 3600, 'NX');
    if (result === null) {
      audioDedupHitTotal.inc();
      return { ok: true, dedup: true, receivedAt, traceId };
    }
  } catch (e) {
    if (process.env.API_DEBUG === '1') console.warn('dedupe skipped:', e);
  }

  const payload = {
    chunkId,
    sessionId,
    groupId,
    startTs,
    endTs,
    mime,
    bytes,
    schoolId: undefined as any,
    traceId,
    receivedAt,
    audioB64: file.buffer.toString('base64'),
  };

  const { getAudioSttQueue } = await import('../workers/queue.audio-stt');
  const q: BullQueue = await getAudioSttQueue();
  const job = await q.add('audio-stt', payload, {
    attempts: parseInt(process.env.STT_JOB_ATTEMPTS || '3', 10),
    backoff: { type: 'exponential', delay: 500 },
    removeOnComplete: true,
    removeOnFail: 500,
  });
  sttJobsQueuedTotal.inc();
  return { ok: true, queuedJobId: job.id, receivedAt, traceId };
}

export async function handleAudioWindowUpload(req: Request, res: Response) {
  audioUploadTotal.inc();

  const traceId = (res.locals as any)?.traceId || (req as any)?.traceId || req.headers['x-trace-id'] || undefined;
  const receivedAt = Date.now();

  try {
    // Validate fields
    const parsed = AudioWindowUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: 'INVALID_FIELDS' });
    }
    const { sessionId, groupId, chunkId, startTs, endTs } = parsed.data;

    // If kiosk token used, ensure it matches posted session/group
    const kiosk = (req as any).kiosk as { groupId: string; sessionId: string } | undefined;
    if (kiosk) {
      if (kiosk.groupId !== groupId || kiosk.sessionId !== sessionId) {
        return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'Token does not match group/session' });
      }
    }

    // Validate file
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file || !file.buffer) {
      return res.status(400).json({ ok: false, error: 'MISSING_AUDIO' });
    }
    const mime = file.mimetype || 'application/octet-stream';
    if (!isSupportedAudioMime(mime)) {
      return res.status(415).json({ ok: false, error: 'UNSUPPORTED_MEDIA_TYPE', mime });
    }

    uploadBytesHistogram.observe(file.buffer.length);
    const result = await processAudioWindow({ sessionId, groupId, chunkId, startTs, endTs, file, traceId });
    if (process.env.API_DEBUG === '1') {
      console.log('🎙️ AUDIO WINDOW ACCEPTED', { sessionId, groupId, chunkId, bytes: file.buffer.length, queuedJobId: (result as any)?.queuedJobId, dedup: (result as any)?.dedup });
    }
    return res.json(result);
  } catch (err: any) {
    // Multer size error handled here as well
    const code = err?.code === 'LIMIT_FILE_SIZE' ? 413 : 500;
    return res.status(code).json({ ok: false, error: err?.message || 'UPLOAD_FAILED' });
  }
}

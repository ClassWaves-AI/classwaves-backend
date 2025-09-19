import type { Request, Response } from 'express';
import multer from 'multer';
import * as client from 'prom-client';
import { AudioWindowUploadSchema, isSupportedAudioMime } from '../utils/zod-schemas/audio-upload.schema';
import { idempotencyPort } from '../utils/idempotency.port.instance';
import { redisService } from '../services/redis.service';
import { RedisRateLimiter } from '../services/websocket/utils/rate-limiter.util';
import { logger } from '../utils/logger';

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
const audioUploadLabeled = getCounter('audio_upload_requests_total', 'Total audio upload requests (labeled)', ['result']);
const audioDedupHitTotal = getCounter('audio_dedup_hit_total', 'Total dedupe hits for audio windows');
const sttJobsQueuedTotal = getCounter('stt_jobs_queued_total', 'Total STT jobs queued');
const uploadBytesHistogram = getHistogram('audio_upload_window_bytes', 'Uploaded window size (bytes)', [8e3, 3.2e4, 1.28e5, 5.12e5, 2.0e6]);
const audioUploadRateLimitedTotal = getCounter('audio_upload_rate_limited_total', 'Total REST audio uploads rate-limited');

// Simple per-group rate limiter (REST uploads)
const restLimiter = new RedisRateLimiter(redisService.getClient());

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

  // Deduplicate by chunkId (24h TTL) using idempotency wrapper
  const dedupKey = `dedup:audio:chunk:${chunkId}`;
  try {
    const { executed } = await idempotencyPort.withIdempotency(
      dedupKey,
      24 * 3600 * 1000,
      async () => true
    );
    if (!executed) {
      audioDedupHitTotal.inc();
      return { ok: true, dedup: true, receivedAt, traceId };
    }
  } catch (e) {
    if (process.env.API_DEBUG === '1') logger.warn('dedupe skipped:', e);
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

  try {
    // Validate fields
    const parsed = AudioWindowUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      audioUploadLabeled.inc({ result: 'invalid' });
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
      audioUploadLabeled.inc({ result: 'missing' });
      return res.status(400).json({ ok: false, error: 'MISSING_AUDIO' });
    }
    const mime = file.mimetype || 'application/octet-stream';
    if (!isSupportedAudioMime(mime)) {
      audioUploadLabeled.inc({ result: 'unsupported' });
      return res.status(415).json({ ok: false, error: 'UNSUPPORTED_MEDIA_TYPE', mime });
    }

    uploadBytesHistogram.observe(file.buffer.length);

    // REST Guardrails — per-group min-interval + optional simple rate cap
    // Min interval: throttle rapid successive uploads for a group (defaults to ~0.8s)
    try {
      const minIntervalMs = parseInt(process.env.AUDIO_WINDOW_MIN_INTERVAL_MS || '800', 10);
      const minIntervalSec = Math.max(1, Math.ceil(minIntervalMs / 1000));
      if (minIntervalSec > 0) {
        const minKey = `rest:minint:audio:window:${groupId}`;
        // Acquire a short-lived NX lock; if present, we are within the min interval
        const setRes = await redisService.setWithOptions(minKey, '1', minIntervalSec, 'NX');
        if (setRes !== 'OK') {
          audioUploadRateLimitedTotal.inc();
          res.setHeader('Retry-After', String(minIntervalSec));
          if (process.env.API_DEBUG === '1') {
            logger.warn('🛑 REST upload rate-limited (min-interval)', { groupId, minIntervalMs });
          }
          const status = parseInt(process.env.AUDIO_WINDOW_RATE_LIMIT_STATUS || '429', 10);
          return res.status(status).json({ ok: false, error: 'RATE_LIMITED' });
        }
      }
    } catch (error) {
      logger.warn('audio window min-interval check failed', {
        groupId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Optional simple rate cap (legacy config) — keeps compatibility with existing envs
    try {
      const maxPerWindow = parseInt(process.env.AUDIO_REST_MAX_PER_SEC || '0', 10);
      const windowSec = parseInt(process.env.AUDIO_REST_RATE_WINDOW_SEC || '1', 10);
      if (maxPerWindow > 0) {
        const key = `rest:rate:audio:window:${groupId}`;
        const allowed = await restLimiter.allow(key, maxPerWindow, windowSec);
        if (!allowed) {
          audioUploadRateLimitedTotal.inc();
          res.setHeader('Retry-After', String(windowSec));
          if (process.env.API_DEBUG === '1') {
            logger.warn('🛑 REST upload rate-limited (rate-cap)', { groupId, maxPerWindow, windowSec });
          }
          const status = parseInt(process.env.AUDIO_WINDOW_RATE_LIMIT_STATUS || '429', 10);
          return res.status(status).json({ ok: false, error: 'RATE_LIMITED' });
        }
      }
    } catch (error) {
      logger.warn('audio window rate-cap check failed', {
        groupId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const result = await processAudioWindow({ sessionId, groupId, chunkId, startTs, endTs, file, traceId });
    // Update WS namespace ingress timestamp for stall detection (REST path)
    try {
      const { getNamespacedWebSocketService } = await import('../services/websocket/namespaced-websocket.service');
      getNamespacedWebSocketService()?.getSessionsService()?.updateLastIngestAt(sessionId, groupId);
    } catch (error) {
      logger.debug('audio window WS ingest update failed', {
        sessionId,
        groupId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (process.env.API_DEBUG === '1') {
      logger.debug('🎙️ AUDIO WINDOW ACCEPTED', { sessionId, groupId, chunkId, bytes: file.buffer.length, queuedJobId: (result as any)?.queuedJobId, dedup: (result as any)?.dedup });
    }
    audioUploadLabeled.inc({ result: (result as any)?.dedup ? 'dedup' : 'ok' });
    return res.json(result);
  } catch (err: any) {
    // Multer size error handled here as well
    const code = err?.code === 'LIMIT_FILE_SIZE' ? 413 : 500;
    audioUploadLabeled.inc({ result: code === 413 ? 'too_large' : 'error' });
    return res.status(code).json({ ok: false, error: err?.message || 'UPLOAD_FAILED' });
  }
}

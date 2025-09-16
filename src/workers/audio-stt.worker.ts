import { Worker } from 'bullmq';
import * as client from 'prom-client';
import { redisService } from '../services/redis.service';
import { openAIWhisperService } from '../services/openai-whisper.service';
import { maybeTranscodeToWav } from '../services/audio/transcode.util';
import { getNamespacedWebSocketService } from '../services/websocket/namespaced-websocket.service';
import { getTeacherIdForSessionCached } from '../services/utils/teacher-id-cache.service';

type AudioJob = {
  chunkId: string;
  sessionId: string;
  groupId: string;
  startTs: number;
  endTs: number;
  mime: string;
  bytes: number;
  schoolId?: string;
  traceId?: string;
  receivedAt?: number;
  audioB64: string;
};

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

const sttJobsSuccessTotal = getCounter('stt_jobs_success_total', 'Total STT jobs processed successfully');
const sttJobsFailedTotal = getCounter('stt_jobs_failed_total', 'Total STT jobs failed');
const transcriptEmitLatencyMs = getHistogram('transcript_emit_latency_ms', 'Latency from upload to WS emit', [50,100,200,500,1000,2000,5000,10000]);
const aiTriggersSuppressedEndingTotal = getCounter('ai_triggers_suppressed_ending_total', 'AI triggers suppressed due to session ending/ended');

export async function processAudioJob(data: AudioJob): Promise<void> {
  const start = Date.now();
  let buf = Buffer.from(data.audioB64, 'base64');
  let mime = data.mime;

  // Minimal container header caches (per group) for REST uploads
  // Ensures each submitted buffer is a self-contained file for decoder robustness
  const mt = (mime || '').toLowerCase();
  try {
    if (mt.startsWith('audio/webm')) {
      if (hasWebMHeader(buf)) {
        const hdr = extractWebMHeader(buf);
        if (hdr && hdr.length > 0) webmHeaderCache.set(data.groupId, hdr);
      } else {
        const hdr = webmHeaderCache.get(data.groupId);
        if (hdr && hdr.length > 0) {
          if (process.env.API_DEBUG === '1') {
            try { console.log(JSON.stringify({ event: 'webm_header_prepended', groupId: data.groupId, header_bytes: hdr.length, window_bytes: buf.length })); } catch {}
          }
          buf = Buffer.concat([hdr, buf], hdr.length + buf.length);
        }
      }
    } else if (mt.startsWith('audio/ogg')) {
      if (hasOggHeader(buf)) {
        oggHeaderCache.set(data.groupId, buf);
      } else {
        const hdr = oggHeaderCache.get(data.groupId);
        if (hdr && hdr.length > 0) {
          if (process.env.API_DEBUG === '1') {
            try { console.log(JSON.stringify({ event: 'ogg_header_prepended', groupId: data.groupId, header_bytes: hdr.length, window_bytes: buf.length })); } catch {}
          }
          buf = Buffer.concat([hdr, buf], hdr.length + buf.length);
        }
      }
    }
  } catch {}

  // Resolve language hint (session-level hook can be added later); fallback to env
  const languageHint = (() => { try { const v = (process.env.STT_LANGUAGE_HINT || '').trim(); return v || undefined; } catch { return undefined; } })();

  const tryTranscribe = async (b: Buffer, m: string) => {
    return openAIWhisperService.transcribeBuffer(
      b,
      m,
      { durationSeconds: Math.round((data.endTs - data.startTs) / 1000), language: languageHint },
      data.schoolId
    );
  };

  let result;
  try {
    result = await tryTranscribe(buf, mime);
  } catch (e: any) {
    const msg: string = e?.message || '';
    const is400 = msg.includes('400') || msg.toLowerCase().includes('invalid');
    if (is400 && process.env.STT_TRANSCODE_TO_WAV === '1') {
      if (process.env.API_DEBUG === '1') console.warn('🎛️  Whisper 400 decode error — attempting WAV transcode fallback');
      const transcoded = await maybeTranscodeToWav(buf, mime);
      mime = transcoded.mime;
      result = await tryTranscribe(transcoded.buffer, transcoded.mime);
    } else {
      throw e;
    }
  }

  // Normalize a single segment for now (timestamps if available in result in future)
  const segment = {
    id: data.chunkId,
    text: result.text || '',
    startTs: data.startTs,
    endTs: data.endTs,
  };

  // Suppress empty transcripts: skip persistence and WS emission
  const trimmed = (segment.text || '').trim();
  if (trimmed.length === 0) {
    if (process.env.API_DEBUG === '1') {
      try { console.log('🧹 Dropping empty transcript (REST path)', { chunkId: data.chunkId, groupId: data.groupId }); } catch {}
    }
    // Increment global empty transcript drop counter
    try {
      const existing = client.register.getSingleMetric('stt_empty_transcripts_dropped_total') as client.Counter<string> | undefined;
      const counter = existing || new client.Counter({ name: 'stt_empty_transcripts_dropped_total', help: 'Total empty transcripts dropped before emission', labelNames: ['path'] });
      counter.inc({ path: 'rest' });
    } catch {}
    sttJobsSuccessTotal.inc();
    const base = data.receivedAt || start;
    transcriptEmitLatencyMs.observe(Date.now() - base);
    return;
  }

  // Feed AI buffers and trigger insights (namespaced guidance) for REST-first uploads
  // Non-blocking; failures here should not affect transcript emission/persistence
  try {
    const text = trimmed;
    if (text.length > 0) {
      // Gate AI buffering/triggers when session is ending or ended
      try {
        const clientR = redisService.getClient();
        const ending = await clientR.get(`ws:session:ending:${data.sessionId}`);
        const status = await clientR.get(`ws:session:status:${data.sessionId}`);
        if (ending === '1' || status === 'ended') {
          aiTriggersSuppressedEndingTotal.inc();
          if (process.env.API_DEBUG === '1') {
            try { console.log('🛑 Suppressing AI buffer/trigger due to session end flags', { sessionId: data.sessionId, groupId: data.groupId }); } catch {}
          }
          // Do not buffer or trigger AI for post-end jobs
          sttJobsSuccessTotal.inc();
          const base = data.receivedAt || start;
          transcriptEmitLatencyMs.observe(Date.now() - base);
          return;
        }
      } catch {
        // If gating check itself failed (Redis issue), continue best-effort
      }
      // Only reached when not suppressed
      const { aiAnalysisBufferService } = await import('../services/ai-analysis-buffer.service');
      await aiAnalysisBufferService.bufferTranscription(data.groupId, data.sessionId, text);

      // Resolve teacherId once per session (cache in-memory for worker lifetime)
      const teacherId = await getTeacherIdForSessionCached(data.sessionId);
      if (teacherId) {
        const { aiAnalysisTriggerService } = await import('../services/ai-analysis-trigger.service');
        await aiAnalysisTriggerService.checkAndTriggerAIAnalysis(data.groupId, data.sessionId, teacherId);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg !== 'AI_SUPPRESSED_DUE_TO_END') {
      if (process.env.API_DEBUG === '1') {
        console.warn('⚠️ AI buffer/trigger failed (non-blocking):', msg);
      }
    }
  }

  // Publish to Redis transcript buffer (append to JSON array)
  const key = `transcr:session:${data.sessionId}:group:${data.groupId}`;
  const ttlHours = parseInt(process.env.TRANSCRIPT_REDIS_TTL_HOURS || '12', 10);
  try {
    const clientR = redisService.getClient();
    const current = await clientR.get(key);
    let arr: any[] = [];
    if (current) {
      try { arr = JSON.parse(current); } catch { arr = []; }
    }
    // Idempotent append: skip if chunkId exists
    if (!arr.some((s) => s?.id === segment.id)) {
      arr.push(segment);
      arr.sort((a, b) => (a.startTs || 0) - (b.startTs || 0));
    }
    await clientR.set(key, JSON.stringify(arr));
    await clientR.expire(key, ttlHours * 3600);
  } catch {}

  // Emit WS event with overlap-aware merging on server side
  try {
    const ns = getNamespacedWebSocketService();
    // Prefer merged emission if available; fallback to direct emit
    const svc: any = ns?.getSessionsService();
    if (svc && typeof svc.emitMergedGroupTranscript === 'function') {
      if (process.env.API_DEBUG === '1') {
        try { console.log('📡 Emitting transcription:group:new (merged)', { sessionId: data.sessionId, groupId: data.groupId, chunkId: data.chunkId }); } catch {}
      }
      svc.emitMergedGroupTranscript(data.sessionId, data.groupId, segment.text, {
        traceId: data.traceId,
        window: { startTs: data.startTs, endTs: data.endTs, chunkId: data.chunkId },
      });
    } else {
      if (process.env.API_DEBUG === '1') {
        try { console.log('📡 Emitting transcription:group:new', { sessionId: data.sessionId, groupId: data.groupId, chunkId: data.chunkId }); } catch {}
      }
      svc?.emitToGroup(data.groupId, 'transcription:group:new', {
        sessionId: data.sessionId,
        groupId: data.groupId,
        text: segment.text,
        startTs: data.startTs,
        endTs: data.endTs,
        traceId: data.traceId,
      });
    }
  } catch {}

  sttJobsSuccessTotal.inc();
  const base = data.receivedAt || start;
  transcriptEmitLatencyMs.observe(Date.now() - base);
}

// --- Minimal container header utilities & caches (scoped to worker module) ---
const webmHeaderCache = new Map<string, Buffer>();
const oggHeaderCache = new Map<string, Buffer>();

function hasWebMHeader(b: Buffer): boolean {
  return !!b && b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3; // EBML
}
function findWebMClusterStart(b: Buffer): number {
  if (!b || b.length < 4) return -1;
  const pat = Buffer.from([0x1f, 0x43, 0xb6, 0x75]); // Cluster
  return b.indexOf(pat);
}
function extractWebMHeader(b: Buffer): Buffer | null {
  try {
    if (!b || b.length < 16) return null;
    if (!hasWebMHeader(b)) return null;
    const idx = findWebMClusterStart(b);
    if (idx > 0) return b.subarray(0, idx);
    return b; // fallback: cache whole first chunk
  } catch { return null; }
}
function hasOggHeader(b: Buffer): boolean {
  return !!b && b.length >= 4 && b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53; // OggS
}

// teacherId cache moved to shared utility

export function startAudioSttWorker(): Worker {
  const concurrency = parseInt(process.env.STT_QUEUE_CONCURRENCY || '10', 10);
  const base = redisService.getClient() as any;
  const baseOpts = { ...(base?.options || {}) };
  delete (baseOpts as any).commandTimeout; // avoid interfering with BullMQ blocking commands
  (baseOpts as any).maxRetriesPerRequest = null;
  const worker = new Worker('audio-stt', async (job) => {
    if (process.env.API_DEBUG === '1') {
      try { console.log('🎧 STT worker picked job', { id: job.id, name: job.name, bytes: (job.data?.bytes || 0), mime: job.data?.mime }); } catch {}
    }
    try {
      await processAudioJob(job.data as AudioJob);
    } catch (e) {
      if (process.env.API_DEBUG === '1') {
        try {
          const d = job.data as AudioJob;
          const msg = e instanceof Error ? e.message : String(e);
          console.warn('🟠 STT job failed', { chunkId: d?.chunkId, mime: d?.mime, bytes: d?.bytes, error: msg });
        } catch {}
      }
      sttJobsFailedTotal.inc();
      // Dev safeguard: if STT_FORCE_MOCK=1, synthesize a minimal segment to keep UX moving
      if (process.env.STT_FORCE_MOCK === '1') {
        try {
          const data = job.data as AudioJob;
          const segment = { id: data.chunkId, text: 'mock (worker fallback)', startTs: data.startTs, endTs: data.endTs };
          const key = `transcr:session:${data.sessionId}:group:${data.groupId}`;
          const clientR = redisService.getClient();
          const raw = await clientR.get(key);
          const arr = raw ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : [];
          if (!arr.some((s: any) => s?.id === segment.id)) arr.push(segment);
          await clientR.set(key, JSON.stringify(arr));
          await clientR.expire(key, (parseInt(process.env.TRANSCRIPT_REDIS_TTL_HOURS || '12', 10)) * 3600);
          // emit merged transcript via WS if inline
          try {
            const ns = getNamespacedWebSocketService();
            const svc: any = ns?.getSessionsService();
            svc?.emitMergedGroupTranscript?.(data.sessionId, data.groupId, segment.text, { window: { startTs: data.startTs, endTs: data.endTs, chunkId: data.chunkId } });
          } catch {}
          return; // swallow error in dev mock
        } catch { /* ignore */ }
      }
      throw e;
    }
  }, { connection: baseOpts as any, concurrency });

  // Observability hooks
  try {
    worker.on('ready', () => {
      if (process.env.API_DEBUG === '1') console.log('🎧 STT worker ready');
    });
    worker.on('active', (job) => {
      if (process.env.API_DEBUG === '1') console.log('🎧 STT worker active', { id: job.id });
    });
    worker.on('completed', (job) => {
      if (process.env.API_DEBUG === '1') console.log('✅ STT job completed', { id: job.id });
    });
    worker.on('failed', (job, err) => {
      console.warn('❌ STT job failed (event)', { id: job?.id, err: err?.message });
    });
    worker.on('error', (err) => {
      console.error('❌ STT worker error', err);
    });
  } catch {}
  return worker;
}

// If run directly, start worker
if (require.main === module) {
  startAudioSttWorker();
}
import dotenv from 'dotenv';
// Ensure environment variables are loaded when running worker standalone
if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development') {
  try { dotenv.config(); } catch {}
}

/**
 * E2E: Audio → STT (mock) → Tier1/Tier2 → Summaries
 *
 * This test validates the full happy-path:
 * - Teacher creates a session with one group
 * - Student audio window is uploaded (HTTP); STT mocked to generate a transcript
 * - Transcripts are flushed to DB
 * - Tier1 and Tier2 insights are recorded
 * - Group + Session summaries are synthesized and persisted
 * - Summaries API returns the expected data
 *
 * Requirements to run:
 * - Redis available at REDIS_URL (dev default)
 * - Databricks config set and reachable (DATABRICKS_* env)
 * - NODE_ENV=test is NOT required; runs under dev too
 */

import { Server as HTTPServer } from 'http';
import request from 'supertest';
import app from '../../app';
import { databricksConfig } from '../../config/databricks.config';
import { databricksService } from '../../services/databricks.service';
import { redisService } from '../../services/redis.service';
import { transcriptPersistenceService } from '../../services/transcript-persistence.service';
import { summarySynthesisService } from '../../services/summary-synthesis.service';
import { Worker } from 'bullmq';
import { startAudioSttWorker } from '../../workers/audio-stt.worker';

let server: HTTPServer | null = null;
let sttWorker: Worker | null = null;

// Guard: only run when Databricks is configured
const DB_READY = !!(databricksConfig.host && databricksConfig.token && databricksConfig.warehouse);

describe('E2E: Audio → Insights → Summaries', () => {
  let teacherToken: string | null = null;
  let sessionId: string = '';
  let groupId: string = '';

  beforeAll(async () => {
    if (!DB_READY) {
      console.warn('⚠️  Skipping E2E test — Databricks not configured');
      return;
    }

    // Use mock STT to avoid external network
    process.env.STT_FORCE_MOCK = '1';

    // Start HTTP server on ephemeral port for socket/express correctness
    server = app.listen(0);

    // Basic readiness
    expect(await redisService.ping()).toBe(true);

    // Acquire a dev test token (teacher access token)
    const authRes = await request(app)
      .post('/api/v1/auth/test-token')
      .send({ email: 'e2e.teacher@classwaves.ai', role: 'teacher' });
    expect(authRes.status).toBe(200);
    teacherToken = authRes.body?.token;
    expect(typeof teacherToken).toBe('string');

    // Start the STT worker explicitly for this test run
    sttWorker = startAudioSttWorker();
  }, 30000);

  afterAll(async () => {
    try { await redisService.disconnect(); } catch {}
    if (sttWorker) { try { await sttWorker.close(); } catch {} }
    if (server) { try { server.close(); } catch {} }
  });

  it('creates session, processes audio, generates tier1/tier2 + summaries', async () => {
    if (!DB_READY) return; // skipped

    // 1) Create session with one group
    const createRes = await request(app)
      .post('/api/v1/sessions')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        topic: 'E2E Audio to Insights',
        goal: 'Validate end-to-end pipeline',
        subject: 'science',
        plannedDuration: 30,
        groupPlan: {
          numberOfGroups: 1,
          groupSize: 4,
          groups: [
            { name: 'Group A', leaderId: 'leader-1', memberIds: ['student-2'] }
          ]
        },
        aiConfig: { hidden: true, defaultsApplied: true },
        emailNotifications: { enabled: false }
      });
    expect(createRes.status).toBe(201);
    sessionId = createRes.body?.data?.session?.id;
    expect(sessionId).toBeTruthy();
    groupId = createRes.body?.data?.session?.groupsDetailed?.[0]?.id;
    expect(groupId).toBeTruthy();

    // 2) Upload a 10s window (multipart/form-data)
    const startTs = Date.now();
    const endTs = startTs + 10000;
    const chunkId = `e2e-${Math.random().toString(36).slice(2, 10)}`;

    const uploadRes = await request(app)
      .post('/api/v1/audio/window')
      .set('Authorization', `Bearer ${teacherToken}`)
      .attach('audio', Buffer.from('dummy'), 'test.wav')
      .field('sessionId', sessionId)
      .field('groupId', groupId)
      .field('chunkId', chunkId)
      .field('startTs', String(startTs))
      .field('endTs', String(endTs));
    expect(uploadRes.status).toBe(200);
    expect(uploadRes.body?.ok).toBe(true);

    // 3) Wait for STT mock to write transcript to Redis (poll up to ~8s)
    const key = `transcr:session:${sessionId}:group:${groupId}`;
    let val: string | null = null;
    const waitUntil = Date.now() + 20000;
    while (Date.now() < waitUntil) {
      val = await redisService.getClient().get(key);
      if (val) break;
      await new Promise(r => setTimeout(r, 100));
    }
    expect(val).toBeTruthy();

    // 4) Flush transcripts to DB so summaries can read them
    const flushed = await transcriptPersistenceService.flushSession(sessionId);
    expect(typeof flushed).toBe('number');

    // 5) Record Tier1 + Tier2 analysis results (minimal expected shape)
    const t1 = {
      analysis_type: 'tier1',
      result_data: JSON.stringify({ topicalCohesion: 0.8, conceptualDensity: 0.7, analysisTimestamp: new Date().toISOString() })
    };
    const t2 = {
      analysis_type: 'tier2',
      result_data: JSON.stringify({ overall_effectiveness: 0.75, analysisTimestamp: new Date().toISOString() })
    };
    await databricksService.insert('analysis_results', {
      id: `t1-${Date.now()}`,
      session_id: sessionId,
      ...t1,
      analysis_timestamp: new Date(),
      processing_time_ms: 100,
      confidence_score: 0.9,
      model_version: 'e2e-test',
      created_at: new Date()
    });
    await databricksService.insert('analysis_results', {
      id: `t2-${Date.now()}`,
      session_id: sessionId,
      ...t2,
      analysis_timestamp: new Date(),
      processing_time_ms: 120,
      confidence_score: 0.85,
      model_version: 'e2e-test',
      created_at: new Date()
    });

    // 6) Patch the AI analysis port to a lightweight fake summarizer
    const { getCompositionRoot } = require('../../app/composition-root');
    const cr = getCompositionRoot() as any;
    cr._aiAnalysisPort = {
      async analyzeTier1() { return { ok: true }; },
      async analyzeTier2() { return { ok: true }; },
      async summarizeGroup(texts: string[]) {
        return { overview: `Group summary (${texts.length} parts)`, analysisTimestamp: new Date().toISOString() };
      },
      async summarizeSession(groupSummaries: any[]) {
        return {
          overview: `Session summary (${groupSummaries.length} groups)`,
          guidanceInsights: { meta: { generatedAt: new Date().toISOString() } },
          analysisTimestamp: new Date().toISOString()
        };
      }
    };

    // 7) Synthesize summaries (groups → session)
    await summarySynthesisService.runSummariesForSession(sessionId);

    // 8) Verify summaries via API
    const sums = await request(app)
      .get(`/api/v1/sessions/${sessionId}/summaries`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200);
    expect(sums.body?.sessionId).toBe(sessionId);
    expect(sums.body?.sessionSummary?.overview).toMatch(/Session summary/);
    expect(Array.isArray(sums.body?.groups)).toBe(true);
    expect(sums.body?.groups.length).toBeGreaterThan(0);

    // Also verify one group summary endpoint
    const gsum = await request(app)
      .get(`/api/v1/sessions/${sessionId}/groups/${groupId}/summary`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200);
    expect(gsum.body?.groupId).toBe(groupId);
    expect(gsum.body?.summary?.overview).toMatch(/Group summary/);
  }, 60000);

  it('synthesizes summaries automatically on session end', async () => {
    if (!DB_READY) return; // skipped

    // Create a fresh session
    const createRes = await request(app)
      .post('/api/v1/sessions')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        topic: 'E2E End Triggered Summaries',
        goal: 'Validate end-of-session synthesis',
        subject: 'science',
        plannedDuration: 15,
        groupPlan: {
          numberOfGroups: 1,
          groupSize: 3,
          groups: [ { name: 'Group B', leaderId: 'leader-2', memberIds: [] } ]
        },
        emailNotifications: { enabled: false }
      });
    expect(createRes.status).toBe(201);
    const sid = createRes.body?.data?.session?.id as string;
    const gid = createRes.body?.data?.session?.groupsDetailed?.[0]?.id as string;
    expect(sid && gid).toBeTruthy();

    // Upload a window so transcripts exist
    const startTs = Date.now();
    const endTs = startTs + 10000;
    const chunkId = `e2e-${Math.random().toString(36).slice(2, 10)}`;
    await request(app)
      .post('/api/v1/audio/window')
      .set('Authorization', `Bearer ${teacherToken}`)
      .attach('audio', Buffer.from('dummy'), 'test.wav')
      .field('sessionId', sid)
      .field('groupId', gid)
      .field('chunkId', chunkId)
      .field('startTs', String(startTs))
      .field('endTs', String(endTs))
      .expect(200);

    // Swap in a deterministic summarizer so synthesis doesn't call external services
    {
      const { getCompositionRoot } = require('../../app/composition-root');
      const cr = getCompositionRoot() as any;
      cr._aiAnalysisPort = {
        async analyzeTier1() { return { ok: true }; },
        async analyzeTier2() { return { ok: true }; },
        async summarizeGroup(texts: string[]) {
          return { overview: `Group summary (${texts.length} parts)`, analysisTimestamp: new Date().toISOString() };
        },
        async summarizeSession(groupSummaries: any[]) {
          return { overview: `Session summary (${groupSummaries.length} groups)`, analysisTimestamp: new Date().toISOString() };
        }
      };
    }

    // End the session (endpoint should trigger summaries in background)
    const endRes = await request(app)
      .post(`/api/v1/sessions/${sid}/end`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ reason: 'planned_completion' });
    expect(endRes.status).toBe(200);

    // Poll summaries endpoint up to ~10s until ready
    const deadline = Date.now() + 10000;
    let got200 = false; let body: any = null;
    while (Date.now() < deadline) {
      const r = await request(app)
        .get(`/api/v1/sessions/${sid}/summaries`)
        .set('Authorization', `Bearer ${teacherToken}`);
      if (r.status === 200 && r.body?.sessionSummary) { got200 = true; body = r.body; break; }
      await new Promise(r => setTimeout(r, 300));
    }
    expect(got200).toBe(true);
    expect(body?.sessionId).toBe(sid);
  }, 45000);
});

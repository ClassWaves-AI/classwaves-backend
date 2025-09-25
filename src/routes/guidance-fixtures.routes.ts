import { Router, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import * as client from 'prom-client';
import { authenticate } from '../middleware/auth.middleware';
import { requireAnyAdmin } from '../middleware/admin-route-security.middleware';
import type { AuthRequest } from '../types/auth.types';
import { loadGuidanceFixture, listGuidanceFixtures } from '../guidance/fixture-library';
import {
  diffGuidanceMetricsSnapshots,
  guidanceMetricsBaselineExists,
  normaliseSnapshot,
  readGuidanceMetricsBaseline,
  writeGuidanceMetricsBaseline,
  type FixtureMetricsSnapshot,
} from '../guidance/metrics-baseline';
import { aiAnalysisBufferService } from '../services/ai-analysis-buffer.service';
import { aiAnalysisTriggerService } from '../services/ai-analysis-trigger.service';
import { logger } from '../utils/logger';

const router = Router();

const replayRequestSchema = z.object({
  fixtureId: z.string().min(1),
  sessionId: z.string().min(1),
  groupId: z.string().min(1),
  playback: z
    .object({
      speedMultiplier: z.number().positive().max(10).optional(),
      msBetweenLinesOverride: z.number().int().min(0).optional(),
    })
    .optional(),
  options: z
    .object({
      includeTier2: z.boolean().optional(),
    })
    .optional(),
});

const MAX_LINES_BEFORE_DELAY = 500;
const DEFAULT_DELAY_MS = 4000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const bucketUpperBoundSchema = z.union([z.string(), z.number()]).transform((value) => value.toString());

const histogramBucketSchema = z.object({
  upperBound: bucketUpperBoundSchema,
  count: z.number().min(0),
});

const histogramSnapshotSchema = z.object({
  count: z.number().min(0),
  sum: z.number(),
  buckets: z.array(histogramBucketSchema),
});

const baselineUpdateSchema = z.object({
  baseline: z.record(z.string(), histogramSnapshotSchema),
  confirm: z.literal(true),
  force: z.boolean().optional(),
  note: z.string().max(200).optional(),
});

type BaselineUpdatePayload = z.infer<typeof baselineUpdateSchema>;

function parseBooleanQuery(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
  }
  return false;
}

function ensureFixturesEnabled(res: Response): boolean {
  if (process.env.CW_GUIDANCE_TRANSCRIPT_FIXTURES_ENABLED !== '1') {
    res.status(403).json({
      success: false,
      error: 'REPLAY_DISABLED',
      message: 'Transcript fixture replay is disabled. Set CW_GUIDANCE_TRANSCRIPT_FIXTURES_ENABLED=1 to enable.',
    });
    return false;
  }

  if (process.env.NODE_ENV === 'production') {
    res.status(403).json({
      success: false,
      error: 'ENV_RESTRICTED',
      message: 'Transcript fixture replay is not available in production environments.',
    });
    return false;
  }

  return true;
}

router.use((req, res, next) => authenticate(req, res, next));

const adminGuard = requireAnyAdmin as unknown as RequestHandler;

router.get('/', adminGuard, (req, res) => {
  if (!ensureFixturesEnabled(res)) {
    return;
  }

  try {
    const fixtures = listGuidanceFixtures().map((fixture) => ({
      ...fixture,
      hasBaseline: guidanceMetricsBaselineExists(fixture.id),
    }));

    res.json({
      success: true,
      fixtures,
    });
  } catch (error) {
    logger.error('Failed to list guidance fixtures', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      success: false,
      error: 'LIST_FAILED',
      message: 'Unable to list guidance fixtures. Check server logs for details.',
    });
  }
});

router.get('/:fixtureId', adminGuard, (req, res) => {
  if (!ensureFixturesEnabled(res)) {
    return;
  }

  const { fixtureId } = req.params;
  const includeTranscript = parseBooleanQuery(req.query.includeTranscript);
  const includeBaseline = parseBooleanQuery(req.query.includeBaseline);

  try {
    const fixture = loadGuidanceFixture(fixtureId);
    const baseline = includeBaseline ? readGuidanceMetricsBaseline(fixtureId) : null;

    res.json({
      success: true,
      hasBaseline: guidanceMetricsBaselineExists(fixtureId),
      fixture: {
        metadata: fixture.metadata,
        playback: fixture.playback,
        featureFlags: fixture.featureFlags,
        expectations: fixture.expectations,
        transcript: includeTranscript ? fixture.transcript : undefined,
      },
      baseline: includeBaseline ? baseline ?? null : undefined,
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: 'FIXTURE_NOT_FOUND',
      message: (error as Error).message,
    });
  }
});

router.get('/:fixtureId/baseline', adminGuard, (req, res) => {
  if (!ensureFixturesEnabled(res)) {
    return;
  }

  const { fixtureId } = req.params;
  const baseline = readGuidanceMetricsBaseline(fixtureId);

  if (!baseline) {
    return res.status(404).json({
      success: false,
      error: 'BASELINE_NOT_FOUND',
          message: `No metrics baseline recorded for fixture '${fixtureId}'.`,
    });
  }

  return res.json({
    success: true,
    fixtureId,
    baseline,
  });
});

router.post('/:fixtureId/baseline', adminGuard, (req, res) => {
  if (!ensureFixturesEnabled(res)) {
    return;
  }

  const parseResult = baselineUpdateSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_REQUEST',
      details: parseResult.error.format(),
    });
  }

  const { fixtureId } = req.params;
  const payload: BaselineUpdatePayload = parseResult.data;
  const { baseline, force = false, note } = payload;

  try {
    // Ensure fixture exists before updating baselines
    loadGuidanceFixture(fixtureId);
  } catch (error) {
    return res.status(404).json({
      success: false,
      error: 'FIXTURE_NOT_FOUND',
      message: (error as Error).message,
    });
  }

  try {
    const snapshot = normaliseSnapshot(baseline as FixtureMetricsSnapshot);
    const existing = readGuidanceMetricsBaseline(fixtureId);
    const normalizedExisting = existing ? normaliseSnapshot(existing) : null;
    const diffs = normalizedExisting ? diffGuidanceMetricsSnapshots(normalizedExisting, snapshot) : [];

    if (existing && diffs.length > 0 && !force) {
      return res.status(409).json({
        success: false,
        error: 'BASELINE_MISMATCH',
        message: 'Existing baseline differs from submitted snapshot. Re-send with force=true to overwrite.',
        diffs,
      });
    }

    writeGuidanceMetricsBaseline(fixtureId, snapshot);
    logger.warn('Guidance metrics baseline updated', {
      fixtureId,
      updated: Boolean(existing),
      diffCount: diffs.length,
      note,
    });

    return res.json({
      success: true,
      fixtureId,
      updated: Boolean(existing),
      diffs,
    });
  } catch (error) {
    logger.error('Failed to update guidance metrics baseline', {
      fixtureId,
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({
      success: false,
      error: 'BASELINE_WRITE_FAILED',
      message: 'Unable to persist guidance metrics baseline. Check server logs for details.',
    });
  }
});

router.post('/replay', async (req, res) => {
  if (!ensureFixturesEnabled(res)) {
    return;
  }

  const parsed = replayRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_REQUEST',
      details: parsed.error.format(),
    });
  }

  const { fixtureId, sessionId, groupId, playback } = parsed.data;

  let fixture;
  try {
    fixture = loadGuidanceFixture(fixtureId);
  } catch (error) {
    return res.status(404).json({
      success: false,
      error: 'FIXTURE_NOT_FOUND',
      message: (error as Error).message,
    });
  }

  const authReq = req as AuthRequest;
  const teacherId = authReq.user?.id;
  if (!teacherId) {
    return res.status(401).json({
      success: false,
      error: 'AUTH_REQUIRED',
      message: 'Authenticated teacher context is required to replay fixtures.',
    });
  }

  const baseDelay = playback?.msBetweenLinesOverride ?? fixture.playback?.msBetweenLines ?? DEFAULT_DELAY_MS;
  const speedMultiplier = playback?.speedMultiplier && playback.speedMultiplier > 0 ? playback.speedMultiplier : 1;
  const effectiveDelay = Math.floor(baseDelay / speedMultiplier);

  const originalAutoPrompts = process.env.GUIDANCE_AUTO_PROMPTS;
  const originalEpisodes = process.env.CW_GUIDANCE_EPISODES_ENABLED;

  try {
    if (typeof fixture.featureFlags?.guidanceAutoPrompts === 'boolean') {
      process.env.GUIDANCE_AUTO_PROMPTS = fixture.featureFlags.guidanceAutoPrompts ? '1' : '0';
    }
    if (typeof fixture.featureFlags?.cwGuidanceEpisodesEnabled === 'boolean') {
      process.env.CW_GUIDANCE_EPISODES_ENABLED = fixture.featureFlags.cwGuidanceEpisodesEnabled ? '1' : '0';
    }

    const start = Date.now();
    let streamed = 0;

    for (const [index, line] of fixture.transcript.entries()) {
      const formatted = line.speakerLabel ? `${line.speakerLabel}: ${line.text}` : line.text;
      await aiAnalysisBufferService.bufferTranscription(groupId, sessionId, formatted);
      streamed += 1;

      if (effectiveDelay > 0 && streamed < fixture.transcript.length && fixture.transcript.length <= MAX_LINES_BEFORE_DELAY) {
        await sleep(effectiveDelay);
      }

      if ((index + 1) % 20 === 0) {
        logger.debug('Fixture replay progress', { fixtureId, streamed });
      }
    }

    await aiAnalysisTriggerService.checkAndTriggerAIAnalysis(groupId, sessionId, teacherId);
    const metrics = await client.register.getMetricsAsJSON();

    return res.json({
      success: true,
      fixtureId,
      streamed,
      sessionId,
      groupId,
      elapsedMs: Date.now() - start,
      delayMs: effectiveDelay,
      metrics,
    });
  } catch (error) {
    logger.error('Fixture replay failed', {
      fixtureId,
      sessionId,
      groupId,
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({
      success: false,
      error: 'REPLAY_FAILED',
      message: 'Failed to replay guidance fixture. Check server logs for details.',
    });
  } finally {
    process.env.GUIDANCE_AUTO_PROMPTS = originalAutoPrompts;
    process.env.CW_GUIDANCE_EPISODES_ENABLED = originalEpisodes;
  }
});

export default router;

import { z } from 'zod';
import {
  updateSessionSchema,
  transcriptsQuerySchema,
  analyticsSampleRateSchema,
  analyticsCleanupSchema,
  analyticsCacheSyncSchema,
  analyticsLogsQuerySchema,
  analyticsCostAnalysisQuerySchema,
  resendSessionEmailSchema,
  sessionLifecycleNotesSchema,
} from '../../../utils/validation.schemas';

describe('REST-edge validation schemas (Phase 3)', () => {
  describe('updateSessionSchema', () => {
    it('accepts a subset of allowed fields', () => {
      const data = { title: 'New Title', planned_duration_minutes: 60 };
      const r = updateSessionSchema.safeParse(data);
      expect(r.success).toBe(true);
    });

    it('rejects empty body', () => {
      const r = updateSessionSchema.safeParse({});
      expect(r.success).toBe(false);
    });

    it('rejects invalid ISO datetime', () => {
      const r = updateSessionSchema.safeParse({ scheduled_start: '2024/01/01 10:00:00' });
      expect(r.success).toBe(false);
    });

    it('restricts status enum', () => {
      const r = updateSessionSchema.safeParse({ status: 'invalid' as any });
      expect(r.success).toBe(false);
    });
  });

  describe('transcriptsQuerySchema', () => {
    it('validates required params', () => {
      const r = transcriptsQuerySchema.safeParse({ sessionId: 's1', groupId: 'g1' });
      expect(r.success).toBe(true);
    });

    it('supports since/until numeric coercion and order', () => {
      const r = transcriptsQuerySchema.safeParse({ sessionId: 's', groupId: 'g', since: '10', until: '20' });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.since).toBe(10);
    });

    it('rejects when since > until', () => {
      const r = transcriptsQuerySchema.safeParse({ sessionId: 's', groupId: 'g', since: 30, until: 10 });
      expect(r.success).toBe(false);
    });
  });

  describe('analytics monitoring schemas', () => {
    it('sample rate bounds', () => {
      expect(analyticsSampleRateSchema.safeParse({ sampleRate: 0.5 }).success).toBe(true);
      expect(analyticsSampleRateSchema.safeParse({ sampleRate: -0.1 }).success).toBe(false);
      expect(analyticsSampleRateSchema.safeParse({ sampleRate: 1.1 }).success).toBe(false);
    });

    it('cleanup hours default and bounds', () => {
      const r = analyticsCleanupSchema.safeParse({});
      expect(r.success).toBe(true);
      if (r.success) expect(r.data?.olderThanHours).toBe(24);
      expect(analyticsCleanupSchema.safeParse({ olderThanHours: 0 }).success).toBe(false);
    });

    it('cache sync defaults', () => {
      const r = analyticsCacheSyncSchema.safeParse({});
      expect(r.success).toBe(true);
      if (r.success) expect(r.data?.force).toBe(false);
    });

    it('logs query validates limit and since format', () => {
      expect(analyticsLogsQuerySchema.safeParse({ limit: 10 }).success).toBe(true);
      expect(analyticsLogsQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
      expect(analyticsLogsQuerySchema.safeParse({ since: 'not-a-date' }).success).toBe(false);
    });

    it('cost analysis timeframe default and bounds', () => {
      const r = analyticsCostAnalysisQuerySchema.safeParse({});
      expect(r.success).toBe(true);
      expect(analyticsCostAnalysisQuerySchema.safeParse({ timeframeHours: 169 }).success).toBe(false);
    });
  });

  describe('resendSessionEmailSchema', () => {
    it('allows basic resend by groupId only', () => {
      const r = resendSessionEmailSchema.safeParse({ groupId: 'g1' });
      expect(r.success).toBe(true);
    });

    it('requires newLeaderId when leader_change', () => {
      const r = resendSessionEmailSchema.safeParse({ groupId: 'g1', reason: 'leader_change' });
      expect(r.success).toBe(false);
      const ok = resendSessionEmailSchema.safeParse({ groupId: 'g1', reason: 'leader_change', newLeaderId: 'stu1' });
      expect(ok.success).toBe(true);
    });
  });

  describe('sessionLifecycleNotesSchema', () => {
    it('accepts optional teacher_notes', () => {
      const r = sessionLifecycleNotesSchema.safeParse({ teacher_notes: 'Paused to discuss instructions' });
      expect(r.success).toBe(true);
    });

    it('rejects overly long notes', () => {
      const r = sessionLifecycleNotesSchema.safeParse({ teacher_notes: 'a'.repeat(1001) });
      expect(r.success).toBe(false);
    });
  });
});


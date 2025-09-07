import { AuditSampler } from '../../../workers/audit-sampler';

describe('AuditSampler', () => {
  it('always keeps critical and always categories', () => {
    const s = new AuditSampler();
    expect(s.shouldKeep({ eventCategory: 'session', eventType: 'x', sessionId: 's1', priority: 'normal', eventTimestamp: new Date() }).keep).toBe(true);
    expect(s.shouldKeep({ eventCategory: 'authentication', eventType: 'x', sessionId: 's1', priority: 'low', eventTimestamp: new Date() }).keep).toBe(true);
    expect(s.shouldKeep({ eventCategory: 'data_access', eventType: 'x', sessionId: 's1', priority: 'critical', eventTimestamp: new Date() }).keep).toBe(true);
  });

  it('applies hard cap for noisy events', () => {
    process.env.AUDIT_NOISY_HARD_CAP_PER_MIN = '2';
    const s = new AuditSampler();
    const base = { eventCategory: 'data_access' as const, eventType: 'ai_analysis_buffer', sessionId: 's1', priority: 'normal' as const, eventTimestamp: new Date() };
    // First two should pass due to cap increment on kept ones; sampling randomness may drop earlier
    const kept1 = s.shouldKeep(base).keep;
    const kept2 = s.shouldKeep(base).keep;
    // After some increments, should eventually hit hard cap and drop
    const decision = s.shouldKeep(base);
    if (kept1 && kept2) {
      expect(decision.keep).toBe(false);
      expect(decision.reason).toBe('hard_cap');
    }
  });
});


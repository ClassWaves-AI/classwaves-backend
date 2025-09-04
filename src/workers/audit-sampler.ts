import type { AuditEvent, AuditEventCategory } from '../services/audit-log.types';

const ALWAYS_CATEGORIES: AuditEventCategory[] = [
  'authentication',
  'session',
  'configuration',
  'compliance',
];

const NOISY_EVENT_TYPES = new Set<string>([
  'ai_analysis_buffer',
  'ai_analysis_buffer_access',
]);

const SAMPLE_RATE = parseFloat(process.env.AUDIT_NOISY_SAMPLE_RATE || '0.05');
const HARD_CAP_PER_MIN = parseInt(process.env.AUDIT_NOISY_HARD_CAP_PER_MIN || '100', 10);

function minuteBucket(ts: Date): string {
  const d = new Date(ts);
  d.setSeconds(0, 0);
  return d.toISOString();
}

export type SampleDecision = { keep: boolean; reason?: 'sampled_out' | 'hard_cap' };

export class AuditSampler {
  private perMinuteCounts: Map<string, number> = new Map();

  private key(sessionId: string | undefined | null, eventType: string, bucket: string): string {
    return `${sessionId || 'global'}|${eventType}|${bucket}`;
  }

  shouldKeep(event: Pick<AuditEvent, 'eventCategory' | 'eventType' | 'sessionId' | 'priority' | 'eventTimestamp'>): SampleDecision {
    const ts = event.eventTimestamp || new Date();
    const bucket = minuteBucket(ts);

    // Critical priority always kept
    if (event.priority === 'critical') return { keep: true };

    // Always-keep categories
    if (ALWAYS_CATEGORIES.includes(event.eventCategory)) return { keep: true };

    // Non-noisy events keep
    if (!NOISY_EVENT_TYPES.has(event.eventType)) return { keep: true };

    // Hard cap check
    const k = this.key(event.sessionId, event.eventType, bucket);
    const current = this.perMinuteCounts.get(k) || 0;
    if (current >= HARD_CAP_PER_MIN) return { keep: false, reason: 'hard_cap' };

    // Probabilistic sampling
    const rnd = Math.random();
    if (rnd > SAMPLE_RATE) return { keep: false, reason: 'sampled_out' };

    // Record kept event toward hard cap
    this.perMinuteCounts.set(k, current + 1);
    return { keep: true };
  }
}

export const createAuditSampler = () => new AuditSampler();


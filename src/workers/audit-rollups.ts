import type { AuditEventCategory } from '../services/audit-log.types';

type RollupKeyParts = {
  schoolId: string;
  sessionId?: string | null;
  eventType: string;
  category: AuditEventCategory;
  reason: 'sampled_out' | 'hard_cap' | 'db_cooldown';
  minuteBucket: string; // ISO minute bucket
};

type RollupCounter = RollupKeyParts & { count: number };

function key(parts: RollupKeyParts): string {
  return [
    parts.schoolId,
    parts.sessionId || 'global',
    parts.eventType,
    parts.category,
    parts.reason,
    parts.minuteBucket,
  ].join('|');
}

export class AuditRollups {
  private counters: Map<string, RollupCounter> = new Map();

  record(parts: RollupKeyParts): void {
    const k = key(parts);
    const prev = this.counters.get(k);
    if (prev) {
      prev.count += 1;
    } else {
      this.counters.set(k, { ...parts, count: 1 });
    }
  }

  size(): number {
    return this.counters.size;
  }

  flushToAuditRows(): Array<Record<string, any>> {
    if (this.counters.size === 0) return [];
    const rows: Array<Record<string, any>> = [];
    const now = new Date();
    for (const c of this.counters.values()) {
      rows.push({
        id: `${c.schoolId}-${c.eventType}-${c.minuteBucket}-${c.reason}`,
        actor_id: 'system',
        actor_type: 'system',
        event_type: `${c.eventType}_rollup`,
        event_category: c.category,
        event_timestamp: new Date(c.minuteBucket),
        resource_type: 'audit_rollup',
        resource_id: `${c.reason}`,
        school_id: c.schoolId,
        session_id: c.sessionId || null,
        description: `rollup ${c.reason} count=${c.count} for ${c.eventType}`,
        ip_address: null,
        user_agent: null,
        compliance_basis: null,
        data_accessed: null,
        affected_student_ids: null,
        created_at: now,
      });
    }
    this.counters.clear();
    return rows;
  }
}

export const createAuditRollups = () => new AuditRollups();


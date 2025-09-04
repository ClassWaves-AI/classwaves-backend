import type { AuditLogPort } from '../services/audit-log.port';
import type { AuditEvent } from '../services/audit-log.types';
import { sanitizeAuditEvent } from './audit-sanitizer';
import { redisService } from '../services/redis.service';

const STREAM_KEY = process.env.AUDIT_LOG_STREAM_KEY || 'audit:log';
const MAX_BACKLOG = parseInt(process.env.AUDIT_LOG_MAX_BACKLOG || '50000', 10);
const ENQUEUE_TIMEOUT_MS = parseInt(process.env.AUDIT_LOG_ENQUEUE_TIMEOUT_MS || '50', 10);

export class RedisAuditLogAdapter implements AuditLogPort {
  async enqueue(event: AuditEvent): Promise<void> {
    try {
      const client = redisService.getClient();

      // Backpressure: drop non-critical if backlog too large
      try {
        const len = await client.xlen(STREAM_KEY);
        if (len > MAX_BACKLOG) {
          const priority = event.priority ?? 'normal';
          if (priority !== 'critical' && priority !== 'high') {
            console.warn(`🛑 Audit enqueue dropped due to backlog (${len} > ${MAX_BACKLOG})`, {
              eventType: event.eventType,
              category: event.eventCategory,
            });
            return; // drop on purpose
          }
        }
      } catch {
        // Non-fatal
      }

      const sanitized = sanitizeAuditEvent(event);
      const fields: Record<string, string> = {
        actor_id: sanitized.actorId,
        actor_type: sanitized.actorType,
        event_type: sanitized.eventType,
        event_category: sanitized.eventCategory,
        event_timestamp: sanitized.eventTimestamp.toISOString(),
        resource_type: sanitized.resourceType,
        resource_id: sanitized.resourceId,
        school_id: sanitized.schoolId,
        description: sanitized.description || '',
        priority: sanitized.priority,
      };
      if (sanitized.sessionId) fields.session_id = sanitized.sessionId;
      if (sanitized.ipAddress) fields.ip_address = sanitized.ipAddress;
      if (sanitized.userAgent) fields.user_agent = sanitized.userAgent;
      if (sanitized.complianceBasis) fields.compliance_basis = sanitized.complianceBasis;
      if (sanitized.dataAccessed) fields.data_accessed = sanitized.dataAccessed;
      if (sanitized.affectedStudentIds && sanitized.affectedStudentIds.length > 0)
        fields.affected_student_ids = JSON.stringify(sanitized.affectedStudentIds);

      const xaddPromise = client.xadd(STREAM_KEY, '*', ...Object.entries(fields).flat());

      const timeout = new Promise<never>((_, reject) => {
        const t = setTimeout(() => reject(new Error('enqueue_timeout')), ENQUEUE_TIMEOUT_MS);
        // avoid keeping process open
        (t as any).unref?.();
      });

      await Promise.race([xaddPromise, timeout]).catch((err) => {
        if (String(err?.message || err) === 'enqueue_timeout') {
          console.warn('⚠️ Audit enqueue slow; timed out', { eventType: event.eventType });
          return; // swallow
        }
        console.warn('⚠️ Audit enqueue failed (non-blocking):', err);
      });
    } catch (err) {
      // Never throw to caller; ensure hot path unaffected
      console.warn('⚠️ Audit enqueue unexpected error (non-blocking):', err);
    }
  }
}

export const redisAuditLogAdapter = new RedisAuditLogAdapter();

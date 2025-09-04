import crypto from 'crypto';
import { z } from 'zod';
import type { AuditEvent } from '../services/audit-log.types';

const MAX_DESCRIPTION_LENGTH = parseInt(process.env.AUDIT_LOG_MAX_DESCRIPTION_LEN || '256', 10);
const HASH_USER_AGENT = (process.env.AUDIT_HASH_USER_AGENT || '1') === '1';

// Allowlist: letters, numbers, space, dash, underscore, colon, dot, slash
const ALLOWLIST_REGEX = /[^A-Za-z0-9 _:./-]/g;
const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export const auditEventSchema = z.object({
  actorId: z.string().min(1),
  actorType: z.enum(['teacher', 'student', 'system', 'admin']),
  eventType: z.string().min(1),
  eventCategory: z.enum(['authentication', 'session', 'data_access', 'configuration', 'compliance']),
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  schoolId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  description: z.string().optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  complianceBasis: z.enum(['ferpa', 'coppa', 'legitimate_interest', 'consent']).optional(),
  dataAccessed: z.string().optional(),
  affectedStudentIds: z.array(z.string()).optional(),
  eventTimestamp: z.date().optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
});

export type SanitizedAuditEvent = Required<
  Pick<
    AuditEvent,
    | 'actorId'
    | 'actorType'
    | 'eventType'
    | 'eventCategory'
    | 'resourceType'
    | 'resourceId'
    | 'schoolId'
    | 'description'
    | 'eventTimestamp'
    | 'priority'
  >
> &
  Pick<
    AuditEvent,
    'sessionId' | 'ipAddress' | 'userAgent' | 'complianceBasis' | 'dataAccessed' | 'affectedStudentIds'
  >;

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function sanitizeDescription(desc?: string): string {
  if (!desc) return '';
  const noEmails = desc.replace(EMAIL_REGEX, '[redacted]');
  const allowlisted = noEmails.replace(ALLOWLIST_REGEX, '');
  const trimmed = allowlisted.trim();
  return trimmed.length > MAX_DESCRIPTION_LENGTH ? trimmed.slice(0, MAX_DESCRIPTION_LENGTH) : trimmed;
}

export function sanitizeAuditEvent(input: AuditEvent): SanitizedAuditEvent {
  const parsed = auditEventSchema.parse(input);
  const description = sanitizeDescription(parsed.description);
  const eventTimestamp = parsed.eventTimestamp ?? new Date();
  const priority = parsed.priority ?? 'normal';
  const affectedStudentIds = parsed.affectedStudentIds ?? [];
  const userAgent = parsed.userAgent ? (HASH_USER_AGENT ? sha256(parsed.userAgent) : parsed.userAgent) : undefined;

  return {
    actorId: parsed.actorId,
    actorType: parsed.actorType,
    eventType: parsed.eventType,
    eventCategory: parsed.eventCategory,
    resourceType: parsed.resourceType,
    resourceId: parsed.resourceId,
    schoolId: parsed.schoolId,
    sessionId: parsed.sessionId,
    description,
    ipAddress: parsed.ipAddress,
    userAgent,
    complianceBasis: parsed.complianceBasis,
    dataAccessed: parsed.dataAccessed,
    affectedStudentIds,
    eventTimestamp,
    priority,
  };
}

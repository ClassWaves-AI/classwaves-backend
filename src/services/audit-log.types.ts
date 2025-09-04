export type AuditActorType = 'teacher' | 'student' | 'system' | 'admin';
export type AuditEventCategory =
  | 'authentication'
  | 'session'
  | 'data_access'
  | 'configuration'
  | 'compliance';

export type AuditPriority = 'critical' | 'high' | 'normal' | 'low';

// Domain type: IDs only; descriptions must be non-PII (sanitized at adapter edge)
export interface AuditEvent {
  actorId: string;
  actorType: AuditActorType;
  eventType: string;
  eventCategory: AuditEventCategory;
  resourceType: string;
  resourceId: string;
  schoolId: string;
  sessionId?: string | null;
  description?: string; // Keep ID/opaque token based only; PII stripped by adapter
  ipAddress?: string;
  userAgent?: string;
  complianceBasis?: 'ferpa' | 'coppa' | 'legitimate_interest' | 'consent';
  dataAccessed?: string; // Describe data types/categories, not raw PII
  affectedStudentIds?: string[];
  eventTimestamp?: Date; // Defaults set at adapter edge
  priority?: AuditPriority; // Defaults to 'normal'
}


import type { AuditEvent } from './audit-log.types';

export interface AuditLogPort {
  enqueue(event: AuditEvent): Promise<void>;
  flush?(): Promise<void>;
}


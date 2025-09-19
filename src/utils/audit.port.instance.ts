import type { AuditLogPort } from '../services/audit-log.port';
import { RedisAuditLogAdapter } from '../adapters/audit-log.redis';

let instance: AuditLogPort | null = null;

export function getAuditLogPort(): AuditLogPort {
  if (!instance) instance = new RedisAuditLogAdapter();
  return instance;
}

export const auditLogPort: AuditLogPort = getAuditLogPort();


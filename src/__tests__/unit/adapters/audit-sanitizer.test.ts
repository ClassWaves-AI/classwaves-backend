import { sanitizeAuditEvent, sanitizeDescription, auditEventSchema } from '../../../adapters/audit-sanitizer';

describe('audit-sanitizer', () => {
  it('removes emails and non-allowlisted chars from description', () => {
    const desc = 'User john.doe@example.com did something! 🚀 #secret';
    const sanitized = sanitizeDescription(desc);
    expect(sanitized).not.toMatch(/john\.doe@example\.com/);
    expect(sanitized).not.toMatch(/🚀|#|!/);
  });

  it('hashes user agent when enabled', () => {
    process.env.AUDIT_HASH_USER_AGENT = '1';
    const out = sanitizeAuditEvent({
      actorId: 't1',
      actorType: 'teacher',
      eventType: 'login',
      eventCategory: 'authentication',
      resourceType: 'session',
      resourceId: 's1',
      schoolId: 'sch1',
      userAgent: 'Mozilla/5.0',
    } as any);
    expect(out.userAgent).toMatch(/^[a-f0-9]{64}$/);
  });

  it('defaults timestamp and priority and serializes students', () => {
    const out = sanitizeAuditEvent({
      actorId: 't1',
      actorType: 'teacher',
      eventType: 'session_updated',
      eventCategory: 'session',
      resourceType: 'session',
      resourceId: 's1',
      schoolId: 'sch1',
      affectedStudentIds: ['a','b']
    } as any);
    expect(out.eventTimestamp).toBeInstanceOf(Date);
    expect(out.priority).toBe('normal');
    expect(out.affectedStudentIds).toEqual(['a','b']);
  });

  it('rejects invalid category', () => {
    expect(() => auditEventSchema.parse({
      actorId: 't1', actorType: 'teacher', eventType: 'x', eventCategory: 'invalid', resourceType: 'x', resourceId: 'x', schoolId: 'sch1'
    } as any)).toThrow();
  });
});


import { sanitizeDescription, sanitizeAuditEvent } from '../../../adapters/audit-sanitizer'

describe('audit sanitizer', () => {
  it('redacts emails in description', () => {
    const s = sanitizeDescription('Access for john.doe@example.com to roster')
    expect(s).not.toContain('john.doe@example.com')
    // Brackets are removed by allowlist, but the token remains
    expect(s).toContain('redacted')
  })

  it('sanitizes event and hashes UA when enabled', () => {
    const prev = process.env.AUDIT_HASH_USER_AGENT
    process.env.AUDIT_HASH_USER_AGENT = '1'
    const evt = sanitizeAuditEvent({
      actorId: 'a', actorType: 'teacher', eventType: 't', eventCategory: 'data_access', resourceType: 'student', resourceId: 'rid', schoolId: 'sch', userAgent: 'Some UA'
    })
    expect(evt.userAgent).toMatch(/^[a-f0-9]{64}$/)
    process.env.AUDIT_HASH_USER_AGENT = prev
  })
})

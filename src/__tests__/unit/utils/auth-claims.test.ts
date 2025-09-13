import { parseClaims, hasAnyRole, isSuperAdmin } from '../../../utils/auth-claims'

describe('auth-claims parser', () => {
  it('parses legacy role into roles[]', () => {
    const ctx = parseClaims({ userId: 'u1', role: 'admin', email: 'a@b.c', schoolId: 's1' })
    expect(ctx.sub).toBe('u1')
    expect(ctx.roles).toContain('admin')
  })
  it('respects roles[] when present', () => {
    const ctx = parseClaims({ sub: 'u2', roles: ['teacher', 'admin'] })
    expect(ctx.roles).toEqual(expect.arrayContaining(['teacher', 'admin']))
  })
  it('role helpers work', () => {
    const ctx = parseClaims({ sub: 'u3', roles: ['super_admin'] })
    expect(hasAnyRole(ctx, ['admin', 'teacher'])).toBe(false)
    expect(isSuperAdmin(ctx)).toBe(true)
  })
})


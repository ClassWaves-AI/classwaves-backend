import { Request, Response, NextFunction } from 'express'
import { requireAnyRole, requireSuperAdmin, requireSchoolMatch } from '../../../middleware/auth.middleware'

function createRes() {
  const res: Partial<Response> = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  ;(res as any).locals = { traceId: 't1' }
  return res as Response
}

describe('RBAC helpers', () => {
  it('requireAnyRole denies when user lacks role', async () => {
    const req = { authContext: { sub: 'u1', roles: ['teacher'], permissions: [] } } as unknown as Request
    const res = createRes()
    const next = jest.fn()
    await (requireAnyRole('admin') as any)(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
  })
  it('requireSuperAdmin allows super_admin', async () => {
    const req = { authContext: { sub: 'u1', roles: ['super_admin'], permissions: [] } } as unknown as Request
    const res = createRes(); const next = jest.fn()
    await (requireSuperAdmin() as any)(req, res, next)
    expect(next).toHaveBeenCalled()
  })
  it('requireSchoolMatch enforces tenant unless super_admin', async () => {
    const req = { params: { schoolId: 's2' }, school: { id: 's1' }, authContext: { sub: 'u1', roles: ['admin'], permissions: [] } } as unknown as Request
    const res = createRes(); const next = jest.fn()
    await (requireSchoolMatch('schoolId') as any)(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
  })
})


import { Request, Response } from 'express'
import { inviteTeacher } from '../../../controllers/admin.controller'

jest.mock('../../../app/composition-root', () => ({
  getCompositionRoot: () => ({
    getAdminRepository: () => ({
      getSchoolSummaryById: jest.fn().mockResolvedValue({ id: 'sch_1', domain: 'example.edu' }),
      findTeacherByEmail: jest.fn().mockResolvedValue(null),
    }),
  }),
}))

jest.mock('../../../services/redis.service', () => ({
  redisService: {
    getClient: () => ({
      set: jest.fn().mockResolvedValue('OK'),
    }),
  },
}))

function createRes() {
  const res: Partial<Response> = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  ;(res as any).locals = { traceId: 'trace-1' }
  return res as Response
}

describe('Admin Controller – inviteTeacher', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test'
  })

  it('rejects non-admin roles', async () => {
    const req = {
      body: { email: 'new.teacher@example.edu', role: 'teacher' },
      user: { role: 'teacher', id: 't-1' },
      school: { id: 'sch_1' },
      ip: '127.0.0.1',
      headers: {},
    } as unknown as Request
    const res = createRes()
    await inviteTeacher(req, res)
    expect(res.status).toHaveBeenCalledWith(403)
    const payload = (res.json as any).mock.calls[0][0]
    expect(payload.success).toBe(false)
    expect(payload.error.code).toBe('INSUFFICIENT_PERMISSIONS')
  })

  it('enforces domain match for admin role', async () => {
    const req = {
      body: { email: 'new.teacher@other.edu', role: 'teacher' },
      user: { role: 'admin', id: 'a-1' },
      school: { id: 'sch_1' },
      ip: '127.0.0.1',
      headers: {},
    } as unknown as Request
    const res = createRes()
    await inviteTeacher(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    const payload = (res.json as any).mock.calls[0][0]
    expect(payload.success).toBe(false)
    expect(payload.error.code).toBe('INVALID_INPUT')
  })

  it('issues token in non-production environments', async () => {
    const req = {
      body: { email: 'new.teacher@example.edu', role: 'teacher' },
      user: { role: 'admin', id: 'a-1' },
      school: { id: 'sch_1' },
      ip: '127.0.0.1',
      headers: {},
    } as unknown as Request
    const res = createRes()
    await inviteTeacher(req, res)
    expect(res.status).toHaveBeenCalledWith(201)
    const payload = (res.json as any).mock.calls[0][0]
    expect(payload.success).toBe(true)
    expect(payload.data.inviteToken).toBeDefined()
  })
})


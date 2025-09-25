import { Request, Response } from 'express'
import { verifyInvite, acceptInvite } from '../../../controllers/admin.controller'

const mockRedisClient = {
  get: jest.fn(),
  set: jest.fn(),
  setex: jest.fn(),
  del: jest.fn(),
}

jest.mock('../../../services/redis.service', () => ({
  redisService: {
    getClient: () => mockRedisClient,
  },
}))

jest.mock('../../../app/composition-root', () => ({
  getCompositionRoot: () => ({
    getAdminRepository: () => ({
      getSchoolSummaryById: jest.fn().mockResolvedValue({ id: 'sch_1', name: 'Test High', domain: 'example.edu' }),
      findTeacherByEmail: jest.fn().mockResolvedValue(null),
      insertTeacher: jest.fn().mockResolvedValue(undefined),
    }),
  }),
}))

function createRes() {
  const res: Partial<Response> = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  ;(res as any).locals = { traceId: 'trace-1' }
  return res as Response
}

describe('Admin Invites – verify/accept', () => {
  const token = '11111111-1111-4111-8111-111111111111'
  const invitePayload = {
    email: 'new.teacher@example.edu',
    role: 'teacher',
    schoolId: 'sch_1',
    issuedBy: 'admin-1',
    issuedByRole: 'admin',
    issuedAt: new Date().toISOString(),
    version: 1,
  }

  beforeEach(() => {
    mockRedisClient.get.mockReset()
    mockRedisClient.set.mockReset()
    mockRedisClient.setex.mockReset()
    mockRedisClient.del.mockReset()
  })

  it('verify returns 410 when token missing/expired', async () => {
    const req = { params: { token } } as unknown as Request
    const res = createRes()
    const client = (require('../../../services/redis.service').redisService.getClient() as any)
    client.get.mockResolvedValue(null)
    await verifyInvite(req, res)
    expect(res.status).toHaveBeenCalledWith(410)
  })

  it('verify returns role and school metadata on success', async () => {
    const req = { params: { token } } as unknown as Request
    const res = createRes()
    const client = (require('../../../services/redis.service').redisService.getClient() as any)
    client.get.mockResolvedValue(JSON.stringify(invitePayload))
    await verifyInvite(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    const payload = (res.json as any).mock.calls[0][0]
    expect(payload.success).toBe(true)
    expect(payload.data.role).toBe('teacher')
    expect(payload.data.school.id).toBe('sch_1')
  })

  it('accept consumes token and returns ok', async () => {
    const req = { body: { token, name: 'New Teacher' } } as unknown as Request
    const res = createRes()
    const client = (require('../../../services/redis.service').redisService.getClient() as any)
    client.get.mockResolvedValueOnce(JSON.stringify(invitePayload))
    await acceptInvite(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    const payload = (res.json as any).mock.calls[0][0]
    expect(payload.success).toBe(true)
    expect(payload.data.accepted).toBe(true)
    expect(client.del).toHaveBeenCalled()
  })

  it('accept rejects admin role when not issued by super_admin', async () => {
    const req = { body: { token, name: 'New Admin' } } as unknown as Request
    const res = createRes()
    const client = (require('../../../services/redis.service').redisService.getClient() as any)
    client.get.mockResolvedValueOnce(JSON.stringify({ ...invitePayload, role: 'admin', issuedByRole: 'admin' }))
    await acceptInvite(req, res)
    expect(res.status).toHaveBeenCalledWith(403)
  })
})

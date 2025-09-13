import { Request, Response, NextFunction } from 'express'
import { createUserRateLimiter } from '../../../middleware/rate-limit.middleware'

describe('Rate limiter standardized responses', () => {
  const makeRes = () => {
    const res: Partial<Response> = {
      status: jest.fn().mockReturnThis() as any,
      json: jest.fn().mockReturnThis() as any,
    }
    return res
  }

  const makeReq = (overrides: Partial<Request> = {}) => ({
    headers: {},
    ip: '127.0.0.1',
    method: 'GET',
    path: '/unit/test',
    ...overrides,
  }) as unknown as Request

  it('returns standardized 429 envelope from per-user limiter', async () => {
    const limiterMw = createUserRateLimiter('unit-test', 1, 60)
    const req = makeReq()
    const res = makeRes()
    const next = jest.fn() as NextFunction

    // First call passes
    await limiterMw(req, res as Response, next)
    expect(next).toHaveBeenCalled()

    // Second call should be limited
    const res2 = makeRes()
    await limiterMw(req, res2 as Response, jest.fn() as NextFunction)
    expect(res2.status).toHaveBeenCalledWith(429)
    const payload = (res2.json as any).mock.calls[0][0]
    expect(payload.success).toBe(false)
    expect(payload.error.code).toBe('RATE_LIMITED')
  })
})


import { Request, Response } from 'express'
import { rotateTokens } from '../../../controllers/auth.controller'

jest.mock('../../../services/secure-jwt.service', () => ({
  SecureJWTService: {
    rotateTokens: jest.fn().mockResolvedValue(null),
  },
}))

describe('Auth rotateTokens controller', () => {
  const makeRes = () => {
    const res: Partial<Response> = {
      status: jest.fn().mockReturnThis() as any,
      json: jest.fn().mockReturnThis() as any,
      cookie: jest.fn().mockReturnThis() as any,
    }
    return res
  }

  const makeReq = (body: any = {}): Partial<Request> => ({
    body,
    headers: {},
  })

  it('returns 400 INVALID_INPUT when refreshToken missing', async () => {
    const req = makeReq({})
    const res = makeRes()

    await rotateTokens(req as Request, res as Response)

    expect(res.status).toHaveBeenCalledWith(400)
    const payload = (res.json as any).mock.calls[0][0]
    expect(payload.error.code).toBe('INVALID_INPUT')
  })

  it('returns 401 INVALID_TOKEN when rotation fails', async () => {
    const req = makeReq({ refreshToken: 'invalid' })
    const res = makeRes()

    await rotateTokens(req as Request, res as Response)

    expect(res.status).toHaveBeenCalledWith(401)
    const payload = (res.json as any).mock.calls[0][0]
    expect(payload.error.code).toBe('INVALID_TOKEN')
  })
})


import { Request, Response } from 'express'
import { createDistrict, listDistricts } from '../../../controllers/admin.controller'
import { createDistrictSchema } from '../../../utils/validation.schemas'

jest.mock('../../../app/composition-root', () => ({
  getCompositionRoot: () => ({
    getAdminRepository: () => ({
      insertDistrict: jest.fn().mockResolvedValue(undefined),
      getDistrictById: jest.fn().mockResolvedValue({ id: 'd-1', name: 'Metro', state: 'CA' }),
      listDistricts: jest.fn().mockResolvedValue([]),
      countDistricts: jest.fn().mockResolvedValue(0),
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

describe('Admin Districts Controller', () => {
  it('validation fails for invalid create payload', async () => {
    // Minimal invalid body (missing name/state)
    const body = {}
    const parsed = createDistrictSchema.safeParse(body)
    expect(parsed.success).toBe(false)
  })

  it('list returns ok envelope', async () => {
    const req = { query: {} } as unknown as Request
    const res = createRes()
    await listDistricts(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    const payload = (res.json as any).mock.calls[0][0]
    expect(payload.success).toBe(true)
  })
})


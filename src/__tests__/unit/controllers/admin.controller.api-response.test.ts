import { Request, Response } from 'express';
import { listSchools, getPromptDeliverySLI, listTeachers } from '../../../controllers/admin.controller';

jest.mock('../../../app/composition-root', () => ({
  getCompositionRoot: () => ({
    getAdminRepository: () => ({
      listSchools: jest.fn().mockResolvedValue([]),
      countSchools: jest.fn().mockResolvedValue(0),
    }),
  }),
}));

jest.mock('../../../services/redis.service', () => ({
  redisService: {
    getClient: () => ({
      get: jest.fn().mockResolvedValue('0'),
    }),
  },
}));

function createRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe('Admin Controller – api-response harmonization', () => {
  it('listSchools returns standardized fail when not super_admin', async () => {
    const req = { query: {}, user: { role: 'admin' } } as unknown as Request;
    const res = createRes();
    await listSchools(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.success).toBe(false);
    expect(payload.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('getPromptDeliverySLI returns standardized fail when sessionId missing', async () => {
    const req = { query: {} } as unknown as Request;
    const res = createRes();
    await getPromptDeliverySLI(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.success).toBe(false);
    expect(payload.error.code).toBe('MISSING_REQUIRED_FIELD');
  });

  it('listTeachers returns 403 for non-admin roles', async () => {
    const req = { query: {}, user: { role: 'teacher' }, school: { id: 'sch_1' } } as unknown as Request;
    const res = createRes();
    await listTeachers(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.success).toBe(false);
    expect(payload.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });
});

import { Request, Response } from 'express';
import { rotateTokens } from '../../../controllers/auth.controller';

function createRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.cookie = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe('Auth Controller – minimal branches', () => {
  it('rotateTokens returns 400 when refreshToken missing', async () => {
    const req = { body: {} } as unknown as Request;
    const res = createRes();
    await rotateTokens(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect((res.json as any).mock.calls[0][0]).toHaveProperty('error', 'MISSING_REFRESH_TOKEN');
  });
});


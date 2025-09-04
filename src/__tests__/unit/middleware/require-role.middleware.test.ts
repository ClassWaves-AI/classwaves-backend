import { requireRole } from '../../../middleware/auth.middleware';

describe('requireRole middleware', () => {
  const makeRes = () => {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  it('allows when role matches', () => {
    const req: any = { user: { role: 'super_admin' } };
    const res = makeRes();
    const next = jest.fn();
    const mw = requireRole(['super_admin']);
    mw(req as any, res as any, next as any);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects with 403 when role does not match', () => {
    const req: any = { user: { role: 'teacher' } };
    const res = makeRes();
    const next = jest.fn();
    const mw = requireRole(['super_admin']);
    mw(req as any, res as any, next as any);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'FORBIDDEN' }));
  });
});


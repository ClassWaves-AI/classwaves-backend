import { Request, Response } from 'express';
import { listSessions } from '../../../controllers/session.controller';
import { createAuthenticatedRequest, createMockResponse } from '../../utils/test-helpers';

jest.mock('../../../services/query-cache.service');

describe('Session Controller - listSessions cache wiring (session-list)', () => {
  const teacher = { id: 'teacher-42', email: 't@example.com', role: 'teacher' } as any;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    jest.resetAllMocks();
    mockRes = createMockResponse();
  });

  it('wraps listSessions with query cache (session-list) and composes key with filters', async () => {
    const mockReq = createAuthenticatedRequest(teacher, {
      query: { view: 'dashboard', limit: '3', status: 'active', page: '1', sort: 'created_at:desc' },
    }) as any as Request;

    const { queryCacheService } = require('../../../services/query-cache.service');
    const spy = jest
      .spyOn(queryCacheService, 'getCachedQuery')
      .mockResolvedValue({ sessions: [], pagination: { page: 1, limit: 3, total: 0, totalPages: 1 } });

    await listSessions(mockReq, mockRes as Response);

    // Ensure correct queryType and teacherId context
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining(`sessions:teacher:${teacher.id}:view:dashboard:limit:3:status:active:sort:created_at:desc:page:1`),
      'session-list',
      expect.any(Function),
      { teacherId: teacher.id }
    );
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});


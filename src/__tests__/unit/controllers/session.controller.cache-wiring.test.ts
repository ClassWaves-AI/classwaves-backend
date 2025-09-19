import { Request, Response } from 'express';
import { getDashboardMetrics, getGroupsStatus } from '../../../controllers/session.controller';
import { createAuthenticatedRequest, createMockResponse } from '../../utils/test-helpers';

jest.mock('../../../services/query-cache.service');

describe('Session Controller Cache Wiring', () => {
  const teacher = { id: 'teacher-1', email: 't@example.com', school_id: 'school-1', role: 'teacher', status: 'active' } as any;
  const school = { id: 'school-1', name: 'School' } as any;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    jest.resetAllMocks();
    mockRes = createMockResponse();
  });

  it('wraps dashboard metrics with query cache (dashboard-metrics)', async () => {
    const mockReq = createAuthenticatedRequest(teacher, { query: {} }) as any as Request;
    const { queryCacheService } = require('../../../services/query-cache.service');
    const spy = jest.spyOn(queryCacheService, 'getCachedQuery').mockResolvedValue({ metrics: { activeSessions: 1, todaySessions: 2, totalStudents: 3 }, timestamp: 'now' });

    await getDashboardMetrics(mockReq, mockRes as Response);

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('dashboard:teacher:' + teacher.id),
      'dashboard-metrics',
      expect.any(Function),
      { teacherId: teacher.id }
    );
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('wraps group status with query cache (group-status)', async () => {
    const sessionId = 'sess-1';
    const mockReq = createAuthenticatedRequest(teacher, { params: { sessionId } }) as any as Request;

    // Mock session ownership
    const { getCompositionRoot } = require('../../../app/composition-root');
    const mockRoot = getCompositionRoot();
    jest.spyOn(mockRoot, 'getSessionRepository').mockReturnValue({
      getOwnedSessionBasic: jest.fn().mockResolvedValue({ id: sessionId, status: 'created' })
    });

    const { queryCacheService } = require('../../../services/query-cache.service');
    const spy = jest.spyOn(queryCacheService, 'getCachedQuery').mockResolvedValue({ sessionId, groups: [], summary: { totalGroups: 0, readyGroups: 0, issueGroups: 0, allGroupsReady: false, canStartSession: false }, timestamp: 'now' });

    await getGroupsStatus(mockReq, mockRes as Response);

    expect(spy).toHaveBeenCalledWith(
      sessionId,
      'group-status',
      expect.any(Function),
      { sessionId }
    );
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

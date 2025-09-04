import { endSession } from '../../../controllers/session.controller';
import { databricksService } from '../../../services/databricks.service';
import { analyticsComputationService } from '../../../services/analytics-computation.service';
import { createAuthenticatedRequest, createMockResponse } from '../../utils/test-helpers';
import type { AuthRequest } from '../../../types/auth.types';

// Mock namespaced WS service
jest.mock('../../../services/websocket/namespaced-websocket.service', () => {
  const emitToSession = jest.fn();
  return {
    getNamespacedWebSocketService: () => ({
      getSessionsService: () => ({ emitToSession }),
    }),
  };
});

jest.mock('../../../services/databricks.service');

describe('Session Controller — duplicate prevention emission', () => {
  const teacher = { id: '11111111-1111-1111-1111-111111111111', school_id: '22222222-2222-2222-2222-222222222222' } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits analytics:failed with errorType duplicate_prevention on lock contention', async () => {
    const sessionId = '33333333-3333-3333-3333-333333333333';
    const mockReq = createAuthenticatedRequest(teacher, { params: { id: sessionId } });
    const mockRes = createMockResponse();

    // Active session
    (databricksService.queryOne as jest.Mock)
      .mockResolvedValueOnce({ id: sessionId, teacher_id: teacher.id, school_id: teacher.school_id, status: 'active' })
      .mockResolvedValueOnce({ total_groups: 0, total_students: 0, total_transcriptions: 0 });
    (databricksService.updateSessionStatus as jest.Mock).mockResolvedValueOnce(true);

    // Simulate lock contention in analytics compute
    jest.spyOn(analyticsComputationService, 'computeSessionAnalytics').mockRejectedValueOnce(new Error('lock acquisition failed'));

    await endSession(mockReq as AuthRequest, mockRes as any);

    // Assert namespaced emit
    const mod = await import('../../../services/websocket/namespaced-websocket.service');
    const emitSpy = jest.spyOn((mod as any).getNamespacedWebSocketService()?.getSessionsService(), 'emitToSession');

    // Wait a tick for async setImmediate
    await new Promise((r) => setTimeout(r, 20));

    expect(emitSpy).toHaveBeenCalledWith(
      sessionId,
      'analytics:failed',
      expect.objectContaining({ errorType: 'duplicate_prevention' })
    );
  });
});


import { AnalyticsComputationService } from '../../services/analytics-computation.service';

jest.mock('../../services/websocket/namespaced-websocket.service', () => {
  const emitToSession = jest.fn();
  return {
    getNamespacedWebSocketService: () => ({
      getSessionsService: () => ({ emitToSession }),
    }),
  };
});

describe('AnalyticsComputationService.emitAnalyticsFinalized (namespaced)', () => {
  const service = new AnalyticsComputationService();

  beforeEach(() => {
    process.env.ANALYTICS_USE_NAMESPACED = '1';
    jest.clearAllMocks();
  });

  it('emits analytics:finalized via namespaced sessions service when flag enabled', async () => {
    const mod = await import('../../services/websocket/namespaced-websocket.service');
    const spy = jest.spyOn((mod as any).getNamespacedWebSocketService()?.getSessionsService(), 'emitToSession');
    await service.emitAnalyticsFinalized('sess_abc');
    expect(spy).toHaveBeenCalledWith('sess_abc', 'analytics:finalized', expect.any(Object));
  });
});


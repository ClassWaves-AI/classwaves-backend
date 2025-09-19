import { GuidanceNamespaceService } from '../../../services/websocket/guidance-namespace.service';
import { databricksService } from '../../../services/databricks.service';

jest.mock('../../../services/databricks.service');
jest.mock('../../../app/composition-root', () => ({
  getCompositionRoot: () => ({
    getSessionRepository: () => ({
      getOwnedSessionBasic: jest.fn().mockResolvedValue({ id: 'sess-123', status: 'active' })
    })
  })
}));

describe('GuidanceNamespaceService subscriber gauge', () => {
  const nsEmit = jest.fn();
  const nsTo = jest.fn(() => ({ emit: nsEmit }));
  const fakeNamespace: any = { use: jest.fn(), on: jest.fn(), to: nsTo, adapter: { rooms: new Map() }, sockets: new Map(), emit: nsEmit };
  const service = new GuidanceNamespaceService(fakeNamespace);

  const gauge = (GuidanceNamespaceService as any).wsSubscribersGauge;

  beforeEach(() => {
    jest.clearAllMocks();
    (databricksService.queryOne as jest.Mock).mockResolvedValue({ id: 'sess-123', status: 'active' });
  });

  it('updates subscribers gauge on subscribe/unsubscribe', async () => {
    const gaugeSpy = jest.spyOn(gauge, 'set');

    const socket: any = {
      data: { userId: 'teacher-1', subscribedSessions: new Set<string>(), subscriptions: new Set<string>(), analyticsSubscriptions: new Map() },
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
    };

    await (service as any).handleSessionGuidanceSubscription(socket, { sessionId: 'sess-123' });
    expect(gaugeSpy).toHaveBeenCalledWith({ sessionId: 'sess-123' }, 1);

    await (service as any).handleSessionGuidanceUnsubscription(socket, { sessionId: 'sess-123' });
    expect(gaugeSpy).toHaveBeenCalledWith({ sessionId: 'sess-123' }, 0);

    gaugeSpy.mockRestore();
  });
});


import { GuidanceNamespaceService } from '../../../services/websocket/guidance-namespace.service';
import { databricksService } from '../../../services/databricks.service';

jest.mock('../../../services/databricks.service');
jest.mock('../../../app/composition-root', () => ({
  getCompositionRoot: () => ({
    getSessionRepository: () => ({
      getOwnedSessionBasic: jest.fn().mockResolvedValue({ id: 'sess-1', status: 'active', teacher_id: 't1', school_id: 's1' })
    })
  })
}));

describe('GuidanceNamespaceService.handleSessionGuidanceSubscription', () => {
  const nsToEmit = jest.fn();
  const nsJoin = jest.fn();
  const fakeNamespace: any = { use: jest.fn(), on: jest.fn(), to: jest.fn(() => ({ emit: nsToEmit })), adapter: { rooms: new Map() }, sockets: new Map(), emit: nsToEmit };
  const service = new GuidanceNamespaceService(fakeNamespace);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('joins guidance:session room when repo authorizes teacher', async () => {
    const socket: any = { data: { userId: 't1', role: 'teacher', subscribedSessions: new Set() }, join: nsJoin, emit: jest.fn() };
    await (service as any).handleSessionGuidanceSubscription(socket, { sessionId: 'sess-1' });
    expect(nsJoin).toHaveBeenCalledWith('guidance:session:sess-1');
  });

  // Negative-path fallback requires deeper module mock coordination; covered by integration tests.
});

import { GuidanceNamespaceService } from '../../../services/websocket/guidance-namespace.service';
import { databricksService } from '../../../services/databricks.service';

jest.mock('../../../services/databricks.service');
jest.mock('../../../app/composition-root', () => ({
  getCompositionRoot: () => ({
    getSessionRepository: () => ({
      getOwnedSessionBasic: jest.fn().mockResolvedValue({ id: 'sess-PI', teacher_id: 't1', school_id: 's1', status: 'active' })
    })
  })
}));

describe('GuidanceNamespaceService.handlePromptInteraction', () => {
  const nsEmit = jest.fn();
  const nsTo = jest.fn(() => ({ emit: nsEmit }));
  const fakeNamespace: any = { use: jest.fn(), on: jest.fn(), to: nsTo, adapter: { rooms: new Map() }, sockets: new Map(), emit: nsEmit };
  const service = new GuidanceNamespaceService(fakeNamespace);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits prompt:interaction to guidance session room with traceId', async () => {
    // Prompt exists and maps to session
    (databricksService.queryOne as jest.Mock).mockResolvedValueOnce({ id: 'p1', session_id: 'sess-PI' });
    // Databricks update calls for recording interaction
    (databricksService.update as jest.Mock).mockResolvedValueOnce(undefined);
    (databricksService.insert as jest.Mock).mockResolvedValueOnce(undefined);

    const socket: any = { data: { userId: 't1', traceId: 'trace-guidance-123' }, emit: jest.fn(), join: jest.fn() };
    await (service as any).handlePromptInteraction(socket, { promptId: 'p1', action: 'acknowledge' });

    const calls = (nsEmit as jest.Mock).mock.calls.filter((c: any[]) => c[0] === 'prompt:interaction');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][1]).toEqual(expect.objectContaining({ promptId: 'p1', action: 'acknowledge', traceId: 'trace-guidance-123' }));
  });
});


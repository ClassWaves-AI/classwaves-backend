import { GuidanceNamespaceService } from '../../../services/websocket/guidance-namespace.service';
import { databricksService } from '../../../services/databricks.service';
import { redisService } from '../../../services/redis.service';

jest.mock('../../../services/databricks.service');
jest.mock('../../../services/redis.service', () => {
  const client = {
    get: jest.fn().mockResolvedValue('1700000000000'),
    del: jest.fn().mockResolvedValue(1),
    set: jest.fn().mockResolvedValue('OK'),
  };
  return {
    redisService: {
      getClient: jest.fn(() => client),
      getGuidanceScripts: jest.fn(),
    },
  };
});
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
    (redisService.getClient as jest.Mock).mockClear();
    const client = redisService.getClient();
    (client.get as jest.Mock).mockResolvedValue('1700000000000');
    (client.del as jest.Mock).mockResolvedValue(1);
    (client.set as jest.Mock).mockResolvedValue('OK');
  });

  it('emits prompt:interaction to guidance session room with traceId', async () => {
    // Prompt exists and maps to session
    (databricksService.queryOne as jest.Mock).mockResolvedValueOnce({ id: 'p1', session_id: 'sess-PI' });
    // Databricks update calls for recording interaction
    (databricksService.update as jest.Mock).mockResolvedValueOnce(undefined);
    (databricksService.insert as jest.Mock).mockResolvedValueOnce(undefined);

    const actionCounter = (GuidanceNamespaceService as any).promptActionCounter;
    const actionSpy = jest.spyOn(actionCounter, 'inc');
    const histogram = (GuidanceNamespaceService as any).promptFirstActionHistogram;
    const histogramSpy = jest.spyOn(histogram, 'observe');

    const socket: any = { data: { userId: 't1', traceId: 'trace-guidance-123' }, emit: jest.fn(), join: jest.fn() };
    await (service as any).handlePromptInteraction(socket, { promptId: 'p1', action: 'ack' });

    const calls = (nsEmit as jest.Mock).mock.calls.filter((c: any[]) => c[0] === 'prompt:interaction');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][1]).toEqual(expect.objectContaining({
      promptId: 'p1',
      action: 'acknowledge',
      sessionId: 'sess-PI',
      traceId: 'trace-guidance-123',
    }));
    expect(typeof calls[0][1].timestamp).toBe('string');

    const confirmCalls = (socket.emit as jest.Mock).mock.calls.filter((c: any[]) => c[0] === 'prompt:interaction_confirmed');
    expect(confirmCalls[0][1]).toEqual(expect.objectContaining({ action: 'acknowledge', promptId: 'p1' }));
    expect(typeof confirmCalls[0][1].timestamp).toBe('number');

    const client = redisService.getClient();
    expect(client.get).toHaveBeenCalledWith('guidance:prompt:first_emit_at:p1');
    expect(client.del).toHaveBeenCalledWith('guidance:prompt:first_emit_at:p1');
    expect(actionSpy).toHaveBeenCalledWith({ action: 'ack' });
    expect(histogramSpy).toHaveBeenCalledWith(expect.any(Number));

    actionSpy.mockRestore();
    histogramSpy.mockRestore();
  });

  it('skips latency observation when prompt timing key absent', async () => {
    (databricksService.queryOne as jest.Mock).mockResolvedValueOnce({ id: 'p2', session_id: 'sess-PI' });
    (databricksService.update as jest.Mock).mockResolvedValueOnce(undefined);
    (databricksService.insert as jest.Mock).mockResolvedValueOnce(undefined);

    const client = redisService.getClient();
    (client.get as jest.Mock).mockResolvedValueOnce(null);

    const histogram = (GuidanceNamespaceService as any).promptFirstActionHistogram;
    const histogramSpy = jest.spyOn(histogram, 'observe');

    const socket: any = { data: { userId: 't1' }, emit: jest.fn(), join: jest.fn() };
    await (service as any).handlePromptInteraction(socket, { promptId: 'p2', action: 'use' });

    expect(histogramSpy).not.toHaveBeenCalled();
    expect(client.del).not.toHaveBeenCalledWith('guidance:prompt:first_emit_at:p2');

    histogramSpy.mockRestore();
  });

  it('increments redis unavailable counter when prompt timing redis fails', async () => {
    (databricksService.queryOne as jest.Mock).mockResolvedValueOnce({ id: 'p3', session_id: 'sess-PI' });
    (databricksService.update as jest.Mock).mockResolvedValueOnce(undefined);
    (databricksService.insert as jest.Mock).mockResolvedValueOnce(undefined);

    const client = redisService.getClient();
    (client.get as jest.Mock).mockRejectedValueOnce(new Error('redis offline'));

    const redisCounter = (GuidanceNamespaceService as any).redisUnavailableCounter;
    const counterSpy = jest.spyOn(redisCounter, 'inc');

    const socket: any = { data: { userId: 't1' }, emit: jest.fn(), join: jest.fn() };
    await (service as any).handlePromptInteraction(socket, { promptId: 'p3', action: 'copy' });

    expect(counterSpy).toHaveBeenCalledWith({ component: 'prompt_timing' });

    counterSpy.mockRestore();
  });
});

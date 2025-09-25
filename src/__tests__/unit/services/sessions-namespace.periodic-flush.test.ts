import * as client from 'prom-client';
import { SessionsNamespaceService } from '../../../services/websocket/sessions-namespace.service';
import { transcriptPersistenceService } from '../../../services/transcript-persistence.service';

jest.mock('../../../services/transcript-persistence.service', () => ({
  transcriptPersistenceService: {
    flushSession: jest.fn(),
  },
}));

describe('SessionsNamespaceService periodic transcript flush', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    client.register.resetMetrics();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts and stops periodic flush timers based on session status', async () => {
    (transcriptPersistenceService.flushSession as jest.Mock).mockResolvedValue(3);

    const namespaceMock = {
      name: '/sessions',
      use: jest.fn(),
      on: jest.fn(),
      emit: jest.fn(),
      to: jest.fn(() => ({ emit: jest.fn() })),
      server: { of: jest.fn() },
    } as any;

    const service: any = Object.create(SessionsNamespaceService.prototype);
    service.namespace = namespaceMock;
    service.connectedUsers = new Map();
    service.groupFlushTimers = new Map();
    service.sessionTranscriptFlushTimers = new Map();
    service.activeTranscriptFlushes = new Set();
    service.transcriptFlushIntervalMs = 10;
    service.emitToRoom = jest.fn();

    service.emitToSession('session-123', 'session:status_changed', { status: 'active' });
    expect(service.sessionTranscriptFlushTimers.has('session-123')).toBe(true);

    jest.advanceTimersByTime(10);
    await Promise.resolve();
    expect(transcriptPersistenceService.flushSession).toHaveBeenCalledWith('session-123');

    const flushMetric = client.register.getSingleMetric('transcript_flush_total') as client.Counter<string> | undefined;
    expect(flushMetric).toBeDefined();
    const metric = await flushMetric!.get();
    const values = metric.values;
    expect(values.some((v) => v.labels.reason === 'periodic' && v.value >= 3)).toBe(true);

    (transcriptPersistenceService.flushSession as jest.Mock).mockClear();
    service.emitToSession('session-123', 'session:status_changed', { status: 'paused' });
    expect(service.sessionTranscriptFlushTimers.has('session-123')).toBe(false);

    jest.advanceTimersByTime(10);
    await Promise.resolve();
    expect(transcriptPersistenceService.flushSession).not.toHaveBeenCalled();
  });
});

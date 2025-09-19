import { Namespace } from 'socket.io';

// Mock dynamic import of InMemoryAudioProcessor used in sessions namespace
jest.mock('../../services/audio/InMemoryAudioProcessor', () => {
  const seq: any[] = [];
  const ingest = jest.fn((groupId: string, _buf: Buffer, _mime: string, _sessionId: string) => {
    if (seq.length === 0) {
      // Default: simple line
      return Promise.resolve({ text: 'The trigger.', confidence: 0.95, language: 'en', timestamp: new Date().toISOString() });
    }
    const next = seq.shift();
    return Promise.resolve(next);
  });
  return {
    inMemoryAudioProcessor: {
      ingestGroupAudioChunk: ingest,
      getGroupWindowInfo: (_gid: string) => ({ bytes: 0, chunks: 0, windowSeconds: 1 })
    },
    __setSequence: (arr: any[]) => { seq.splice(0, seq.length, ...arr); },
    __getIngestMock: () => ingest,
  };
});

// Minimal fake namespace with required methods for base service
const makeFakeNs = (): Namespace => {
  const handlers: Record<string, Function[]> = {};
  const ns: any = {
    use: (_fn: any) => { /* ignore middleware in unit test */ },
    on: (event: string, handler: Function) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(handler);
    },
    to: (_room: string) => ({ emit: (_: string, __: any) => true }),
    emit: (_: string, __: any) => true,
    adapter: { rooms: new Map() },
    sockets: new Map(),
  };
  return ns as Namespace;
};

describe('SessionsNamespaceService merge overlap', () => {
  it('merges overlapping window output and suppresses duplicates', async () => {
    const { SessionsNamespaceService } = await import('../../services/websocket/sessions-namespace.service');
    const svc = new SessionsNamespaceService(makeFakeNs());

    // Stub snapshot cache and auth checks
    (svc as any).snapshotCache = { get: jest.fn().mockResolvedValue({ status: 'active' }) };
    (svc as any).verifyGroupAudioAuthorization = jest.fn().mockResolvedValue({ authorized: true });

    // Capture emitted transcripts
    const emitted: any[] = [];
    (svc as any).emitToRoom = (_room: string, event: string, payload: any) => {
      if (event === 'transcription:group:new') emitted.push(payload);
      return true;
    };

    const socket: any = { id: 'sock1', data: { sessionId: 's1', userId: 'u1', role: 'student' } };
    const mocked: any = require('../../services/audio/InMemoryAudioProcessor');

    // First window: base line
    mocked.__setSequence([{ text: 'The trigger.', confidence: 0.95, language: 'en', timestamp: new Date().toISOString() }]);
    await (svc as any).handleAudioChunk(socket, { groupId: 'g1', audioData: Buffer.from([1]), mimeType: 'audio/webm;codecs=opus' });

    // Second window: overlapped + duplicate clause
    mocked.__setSequence([{ text: 'The trigger. The trigger.', confidence: 0.95, language: 'en', timestamp: new Date(Date.now() + 1000).toISOString() }]);
    await (svc as any).handleAudioChunk(socket, { groupId: 'g1', audioData: Buffer.from([2]), mimeType: 'audio/webm;codecs=opus' });

    // Expect only one emission (second should be suppressed as duplicate after merge)
    expect(emitted.length).toBe(1);
    expect(emitted[0].text).toBe('The trigger.');
  });
});

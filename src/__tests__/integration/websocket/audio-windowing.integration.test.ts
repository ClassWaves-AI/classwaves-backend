import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createServer } from 'http';
import { initializeWebSocket } from '../../../services/websocket.service';
import { inMemoryAudioProcessor } from '../../../services/audio/InMemoryAudioProcessor';
import { openAIWhisperService } from '../../../services/openai-whisper.service';

// Mock Databricks to avoid real DB operations using shared mock
jest.mock('../../../services/databricks.service', () => {
  const { mockDatabricksService } = require('../../mocks/databricks.mock');
  return { databricksService: mockDatabricksService };
});

// Mock Redis adapter usage as disconnected to prevent setup
jest.mock('../../../services/redis.service', () => ({
  redisService: {
    isConnected: () => false,
    getClient: () => ({
      get: jest.fn(),
      set: jest.fn(),
      incrbyfloat: jest.fn(),
    }),
  },
}));

describe('WebSocket audio:chunk -> window boundary -> single Whisper call -> transcript emission', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    process.env.STT_PROVIDER = 'openai';
    process.env.STT_WINDOW_SECONDS = '15';
  });

  it('emits exactly one transcription event and calls Whisper once per window', async () => {
    const httpServer = createServer();
    const ws = initializeWebSocket(httpServer);

    const io = ws.getIO();
    const emitted: Array<{ room: string; event: string; payload: any }> = [];
    const originalTo = (io as any).to?.bind(io);
    // Intercept broadcast emissions
    (io as any).to = (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    });

    // Prepare a fake socket and trigger connection lifecycle
    const fakeSocket: any = {
      data: { userId: 'u1', sessionId: 's1', schoolId: 'sch1', role: 'teacher' },
      rooms: new Set<string>(),
      on: function (event: string, handler: Function) {
        (this._handlers ||= {})[event] = handler;
      },
      emit: jest.fn(),
      join: async function (room: string) { this.rooms.add(room); },
      leave: async function (room: string) { this.rooms.delete(room); },
      _handlers: {} as Record<string, Function>,
    };

    // Trigger server's connection handler by directly invoking the registered listener
    const listeners = (io as any).listeners?.('connection') || [];
    expect(Array.isArray(listeners) && listeners.length > 0).toBe(true);
    listeners[0](fakeSocket);

    // First chunk: should not reach window boundary yet
    const groupId = 'g1';
    const now = Date.now();
    await (fakeSocket._handlers['audio:chunk'] as any)({
      groupId,
      audioData: Buffer.from('abc'),
      format: 'audio/webm',
      timestamp: now,
    });

    // Manipulate internal window start to force boundary on next chunk
    const gw = (inMemoryAudioProcessor as any).groupWindows?.get(groupId);
    expect(gw).toBeDefined();
    gw.windowStartedAt = Date.now() - (gw.windowSeconds * 1000 + 100);

    // Mock Whisper call to be deterministic
    const whisperSpy = jest
      .spyOn(openAIWhisperService, 'transcribeBuffer')
      .mockResolvedValue({ text: 'hello world', confidence: 0.9, language: 'en', duration: 2 } as any);

    // Second chunk: should hit boundary and emit
    await (fakeSocket._handlers['audio:chunk'] as any)({
      groupId,
      audioData: Buffer.from('def'),
      format: 'audio/webm',
      timestamp: now + 1000,
    });

    expect(whisperSpy).toHaveBeenCalledTimes(1);
    expect(emitted.length).toBe(1);
    expect(emitted[0].event).toBe('transcription:group:new');
    expect(emitted[0].room).toBe('session:s1');
    expect(emitted[0].payload.groupId).toBe(groupId);
    expect(typeof emitted[0].payload.text).toBe('string');

    // Restore
    if (originalTo) (io as any).to = originalTo;
    whisperSpy.mockRestore();
  });
});



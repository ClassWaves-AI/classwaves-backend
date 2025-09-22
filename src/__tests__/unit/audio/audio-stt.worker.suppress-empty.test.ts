const wsEmitMock = jest.fn();
jest.mock('../../../services/websocket/namespaced-websocket.service', () => ({
  getNamespacedWebSocketService: () => ({
    getSessionsService: () => ({ emitMergedGroupTranscript: (...args: any[]) => wsEmitMock(...args) }),
  }),
}));

const mockProvider = {
  transcribeBuffer: jest.fn(async () => ({ text: '' } as any)),
};

jest.mock('../../../services/stt.provider', () => ({
  getSttProvider: jest.fn(() => mockProvider),
}));

import { processAudioJob } from '../../../workers/audio-stt.worker';

const store = new Map<string, string>();
const setMock = jest.fn(async (k: string, v: string) => { store.set(k, v); return 'OK'; });
jest.mock('../../../services/redis.service', () => ({
  redisService: {
    getClient: () => ({
      get: jest.fn(async (k: string) => store.get(k) || null),
      set: (...args: any[]) => (setMock as any)(...args),
      expire: jest.fn(async () => 1),
    }),
  },
}));

describe('audio-stt.worker suppress empty transcripts', () => {
  it('does not persist to Redis or emit WS when text is empty', async () => {
    const data = {
      chunkId: 'c-empty',
      sessionId: 's1',
      groupId: 'g1',
      startTs: 0,
      endTs: 1000,
      mime: 'audio/webm',
      bytes: 3800,
      audioB64: Buffer.from('abc').toString('base64'),
    };
    await expect(processAudioJob(data as any)).resolves.toBeUndefined();
    expect(setMock).not.toHaveBeenCalled();
    expect(wsEmitMock).not.toHaveBeenCalled();
  });
});

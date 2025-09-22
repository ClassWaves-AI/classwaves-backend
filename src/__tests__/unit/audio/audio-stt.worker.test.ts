const mockProvider = {
  transcribeBuffer: jest.fn(),
};

jest.mock('../../../services/stt.provider', () => ({
  getSttProvider: jest.fn(() => mockProvider),
}));

jest.mock('../../../services/audio/transcode.util', () => ({
  maybeTranscodeToWav: jest.fn(async (buffer: Buffer) => ({ buffer, mime: 'audio/wav' })),
}));

import { processAudioJob } from '../../../workers/audio-stt.worker';

jest.mock('../../../services/redis.service', () => {
  const store = new Map<string, string>();
  const client = {
    get: jest.fn(async (k: string) => store.get(k) || null),
    set: jest.fn(async (k: string, v: string) => { store.set(k, v); return 'OK'; }),
    expire: jest.fn(async () => 1),
  };
  return { redisService: { getClient: () => client, get: (k: string) => client.get(k) } };
});

describe('audio-stt.worker WAV fallback', () => {
  const data = {
    chunkId: 'c1',
    sessionId: 's1',
    groupId: 'g1',
    startTs: 0,
    endTs: 1000,
    mime: 'audio/webm',
    bytes: 3,
    audioB64: Buffer.from('abc').toString('base64'),
    traceId: 't1',
  };

  beforeAll(() => { process.env.STT_TRANSCODE_TO_WAV = '1'; });

  it('retries with wav once on 400', async () => {
    const calls: any[] = [];
    mockProvider.transcribeBuffer = jest.fn(async (_b: Buffer, m: string) => {
      calls.push(m);
      if (calls.length === 1) throw new Error('Whisper error: 400 Invalid format');
      return { text: 'ok after wav' } as any;
    });

    await expect(processAudioJob(data as any)).resolves.toBeUndefined();
    // Verify segment persisted in Redis
    const { redisService } = require('../../../services/redis.service');
    const key = `transcr:session:${data.sessionId}:group:${data.groupId}`;
    const raw = await redisService.get(key);
    expect(raw).toBeTruthy();
    const arr = JSON.parse(raw);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr[0].id).toBe('c1');
  });
});

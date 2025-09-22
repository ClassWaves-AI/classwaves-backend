// Capture buffers passed to provider for assertions
const calls: { buffer: Buffer; mime: string }[] = [];
const mockProvider = {
  transcribeBuffer: jest.fn(async (b: Buffer, m: string) => {
    calls.push({ buffer: b, mime: m });
    return { text: 'ok' } as any;
  }),
};

jest.mock('../../../services/stt.provider', () => ({
  getSttProvider: jest.fn(() => mockProvider),
}));

jest.mock('../../../services/redis.service', () => {
  const store = new Map<string, string>();
  const client = {
    get: jest.fn(async (k: string) => store.get(k) || null),
    set: jest.fn(async (k: string, v: string) => { store.set(k, v); return 'OK'; }),
    expire: jest.fn(async () => 1),
  };
  return { redisService: { getClient: () => client } };
});

import { processAudioJob } from '../../../workers/audio-stt.worker';

describe('audio-stt.worker - WebM header caching & prepend for REST uploads', () => {
  beforeEach(() => { calls.length = 0; });

  it('caches EBML header from first chunk and prepends to subsequent cluster-only chunks', async () => {
    const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x86]);
    const CLUSTER = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);

    // First job: header-bearing webm buffer (EBML + ... + Cluster)
    const firstBuf = Buffer.concat([EBML, Buffer.from('HEADER'), CLUSTER, Buffer.from('CHUNK1')]);
    const job1 = {
      chunkId: 'c1', sessionId: 's1', groupId: 'g1', startTs: 0, endTs: 1000,
      mime: 'audio/webm;codecs=opus', bytes: firstBuf.length, audioB64: firstBuf.toString('base64')
    };

    // Second job: cluster-only (no EBML header)
    const secondBuf = Buffer.concat([CLUSTER, Buffer.from('CHUNK2')]);
    const job2 = {
      chunkId: 'c2', sessionId: 's1', groupId: 'g1', startTs: 1000, endTs: 2000,
      mime: 'audio/webm;codecs=opus', bytes: secondBuf.length, audioB64: secondBuf.toString('base64')
    };

    await processAudioJob(job1 as any);
    await processAudioJob(job2 as any);

    expect(calls.length).toBe(2);
    const secondCall = calls[1];
    // Assert EBML header present at start of buffer in second call
    const b = secondCall.buffer;
    expect(b[0]).toBe(0x1a);
    expect(b[1]).toBe(0x45);
    expect(b[2]).toBe(0xdf);
    expect(b[3]).toBe(0xa3);
  });
});

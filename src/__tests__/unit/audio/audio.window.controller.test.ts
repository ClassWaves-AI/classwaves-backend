import { processAudioWindow } from '../../../controllers/audio.window.controller';

jest.mock('../../../workers/queue.audio-stt', () => ({
  getAudioSttQueue: async () => ({ add: jest.fn().mockResolvedValue({ id: 'job-1' }) }),
}));

jest.mock('../../../utils/idempotency.port.instance', () => {
  const seen = new Set<string>();
  return {
    idempotencyPort: {
      withIdempotency: jest.fn(async (key: string, _ttlMs: number, handler: () => Promise<unknown>) => {
        if (seen.has(key)) {
          return { executed: false };
        }
        seen.add(key);
        const result = await handler();
        return { executed: true, result };
      }),
    },
  };
});

jest.mock('../../../services/redis.service', () => {
  const store = new Map<string, string>();
  const client = {
    set: jest.fn(async (k: string, v: string, _ex: any, _ttl: any, nx: any) => {
      if (nx === 'NX' && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    }),
  } as any;
  return { redisService: { getClient: () => client } };
});

function mockReqRes(body: any, file?: any) {
  const req: any = { body, file };
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const res: any = { json, status, locals: { traceId: 't-1' } };
  return { req, res, json, status };
}

describe('audio.window.controller', () => {
  const baseFields = { sessionId: 's1', groupId: 'g1', chunkId: 'c1', startTs: '1000', endTs: '2000' };
  const file = { buffer: Buffer.from('abc'), mimetype: 'audio/webm' } as any;

  it('dedup returns ok when duplicate (processAudioWindow)', async () => {
    const call = async () => processAudioWindow({ ...(baseFields as any), startTs: 1000, endTs: 2000, file });
    const r1 = await call();
    const r2 = await call();
    expect(r1.ok).toBe(true);
    expect((r2 as any).dedup).toBe(true);
  });

  it('enqueues a job on first upload (processAudioWindow)', async () => {
    const r = await processAudioWindow({ ...(baseFields as any), chunkId: 'c-new', startTs: 1000, endTs: 2000, file });
    expect(r.ok).toBe(true);
    expect(r.queuedJobId).toBe('job-1');
  });
});

import { transcriptService } from '../../../services/transcript.service';

jest.mock('../../../services/redis.service', () => {
  const store = new Map<string, string>();
  return {
    redisService: {
      get: async (k: string) => store.get(k) || null,
      set: async (k: string, v: string) => { store.set(k, v); },
    },
  };
});

describe('transcript.service', () => {
  it('merges overlapping segments and filters by time', async () => {
    const key = `transcr:session:s1:group:g1`;
    const { redisService } = require('../../../services/redis.service');
    const segments = [
      { id: 'a', text: 'hello', startTs: 0, endTs: 5000 },
      { id: 'b', text: 'world', startTs: 4000, endTs: 9000 },
      { id: 'c', text: 'later', startTs: 15000, endTs: 20000 },
    ];
    await redisService.set(key, JSON.stringify(segments));
    const merged = await transcriptService.read('s1', 'g1', 0, 10000);
    expect(merged.length).toBe(1); // first two overlapped
    expect(merged[0].text).toContain('hello');
    expect(merged[0].text).toContain('world');
  });
});


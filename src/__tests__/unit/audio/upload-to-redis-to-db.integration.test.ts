import { processAudioJob } from '../../../workers/audio-stt.worker';
import { transcriptPersistenceService } from '../../../services/transcript-persistence.service';
import { transcriptService } from '../../../services/transcript.service';

const mockProvider = {
  transcribeBuffer: jest.fn(async () => ({ text: 'hello world', confidence: 0.9, language: 'en', duration: 10 })),
};

jest.mock('../../../services/stt.provider', () => ({
  getSttProvider: jest.fn(() => mockProvider),
}));

jest.mock('../../../services/redis.service', () => {
  const store = new Map<string, string>();
  const wildcardToRegex = (pattern: string) => new RegExp('^' + pattern.replace(/[.+^${}()|[\\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  const client = {
    get: jest.fn(async (k: string) => store.get(k) || null),
    set: jest.fn(async (k: string, v: string) => { store.set(k, v); return 'OK'; }),
    expire: jest.fn(async () => 1),
    keys: jest.fn(async (pattern: string) => {
      const rx = wildcardToRegex(pattern);
      return Array.from(store.keys()).filter(k => rx.test(k));
    })
  };
  return { redisService: { getClient: () => client, get: (k: string) => client.get(k), set: (k: string, v: string) => client.set(k, v), keys: (p: string) => client.keys(p) } };
});

jest.mock('../../../services/databricks.service', () => {
  return {
    databricksService: {
      batchInsert: jest.fn(async () => undefined),
      query: jest.fn(async () => []),
    }
  };
});

jest.mock('../../../config/databricks.config', () => ({ databricksConfig: { catalog: 'classwaves', token: 'TEST_TOKEN' } }));

describe('Pipeline (unit-level integration)', () => {
  it('processes job, persists Redis, flushes to DB, reads transcripts', async () => {
    const prevDbEnabled = process.env.DATABRICKS_ENABLED;
    process.env.DATABRICKS_ENABLED = 'true';
    const data = {
      chunkId: 'chunk-xyz',
      sessionId: 'sess-1',
      groupId: 'group-1',
      startTs: Date.now() - 10000,
      endTs: Date.now(),
      mime: 'audio/webm',
      bytes: 3,
      audioB64: Buffer.from('abc').toString('base64'),
    } as any;

    try {
      await processAudioJob(data);
      const segs = await transcriptService.read(data.sessionId, data.groupId);
      expect(segs.length).toBeGreaterThan(0);
      const flushed = await transcriptPersistenceService.flushSession(data.sessionId);
      expect(flushed).toBeGreaterThan(0);
      const { databricksService } = require('../../../services/databricks.service');
      expect(databricksService.batchInsert).toHaveBeenCalled();
    } finally {
      if (prevDbEnabled === undefined) {
        delete process.env.DATABRICKS_ENABLED;
      } else {
        process.env.DATABRICKS_ENABLED = prevDbEnabled;
      }
    }
  });
});

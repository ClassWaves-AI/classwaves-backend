import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as client from 'prom-client';

jest.mock('../../../services/audio/transcode.util', () => ({
  maybeTranscodeToWav: jest.fn(async (buffer: Buffer, mime: string) => ({ buffer, mime: mime === 'audio/webm' ? 'audio/wav' : mime })),
}));

import { SpeechmaticsSttAdapter } from '../../../adapters/stt.speechmatics';

const mockModule = jest.requireMock('../../../services/audio/transcode.util') as { maybeTranscodeToWav: jest.Mock };
const mockMaybeTranscodeToWav = mockModule.maybeTranscodeToWav;

type MockResponse<T = any> = {
  status: number;
  data: T;
  headers?: Record<string, string>;
};

function createResponse<T>(overrides: MockResponse<T>): MockResponse<T> {
  return {
    status: overrides.status,
    data: overrides.data,
    headers: overrides.headers || {},
  };
}

describe('SpeechmaticsSttAdapter', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.SPEECHMATICS_API_KEY = 'test-key';
    process.env.NODE_ENV = 'development';
    process.env.SPEECHMATICS_POLL_INTERVAL_MS = '0';
    jest.clearAllMocks();
    client.register.clear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('language mode configuration', () => {
    const stubHttp = { request: jest.fn() } as any;

    it('includes language when mode=hint and hint available', () => {
      process.env.STT_LANGUAGE_HINT = 'fr';
      process.env.STT_LANGUAGE_MODE = 'hint';
      const adapter = new SpeechmaticsSttAdapter({ http: stubHttp });
      const config = (adapter as any).buildTranscriptionConfig({});
      expect(config.language).toBe('fr');
    });

    it('omits language when mode=auto even if hint provided', () => {
      process.env.STT_LANGUAGE_HINT = 'de';
      process.env.STT_LANGUAGE_MODE = 'auto';
      const adapter = new SpeechmaticsSttAdapter({ http: stubHttp });
      const config = (adapter as any).buildTranscriptionConfig({ language: 'es' });
      expect(config.language).toBeUndefined();
    });

    it('always uses hint when mode=fixed', () => {
      process.env.STT_LANGUAGE_HINT = 'it';
      process.env.STT_LANGUAGE_MODE = 'fixed';
      const adapter = new SpeechmaticsSttAdapter({ http: stubHttp });
      const config = (adapter as any).buildTranscriptionConfig({ language: 'es' });
      expect(config.language).toBe('it');
    });

    it('falls back to hint when mode value is invalid', () => {
      process.env.STT_LANGUAGE_HINT = 'en';
      process.env.STT_LANGUAGE_MODE = 'foobar';
      const adapter = new SpeechmaticsSttAdapter({ http: stubHttp });
      const config = (adapter as any).buildTranscriptionConfig({});
      expect(config.language).toBe('en');
    });

    it('uses explicit language when hints are absent', () => {
      delete process.env.STT_LANGUAGE_HINT;
      process.env.STT_LANGUAGE_MODE = 'hint';
      const adapter = new SpeechmaticsSttAdapter({ http: stubHttp });
      const config = (adapter as any).buildTranscriptionConfig({ language: 'ja' });
      expect(config.language).toBe('ja');
    });
  });

  describe('dynamic concurrency shaping', () => {
    let responses: MockResponse[];
    let request: jest.Mock;

    beforeEach(() => {
      process.env.CW_STT_SHAPING_ENABLED = '1';
      process.env.SPEECHMATICS_MAX_CONCURRENCY = '4';
      process.env.SPEECHMATICS_PER_SCHOOL_CONCURRENCY = '2';
      process.env.SPEECHMATICS_SHAPING_PENALTY_PCT = '25';
      process.env.SPEECHMATICS_SHAPING_PENALTY_COOLDOWN_MS = '0';
      process.env.SPEECHMATICS_SHAPING_RECOVER_MS = '60000';
      process.env.SPEECHMATICS_API_KEY = 'test-key';
      responses = [];
      request = jest.fn(async () => {
        const next = responses.shift();
        if (!next) throw new Error('No response queued');
        return {
          status: next.status,
          data: next.data,
          headers: next.headers || {},
          statusText: 'OK',
          config: {},
          request: {},
        };
      });
    });

    it('reduces concurrency on 429 and recovers after stability window', async () => {
      const adapter = new SpeechmaticsSttAdapter({ http: { request } as any });

      responses = [
        createResponse({ status: 429, data: { detail: 'rate limit' }, headers: { 'retry-after': '0.1' } }),
        createResponse({ status: 201, data: { job: { id: 'job-err', status: 'running' } } }),
        createResponse({ status: 200, data: { job: { id: 'job-err', status: 'done' } } }),
        createResponse({ status: 200, data: { results: [{ alternatives: [{ text: 'partial' }] }] } }),
      ];

      await adapter.transcribeBuffer(Buffer.from('abc'), 'audio/webm', {}, 'school-x');

      const globalState = (adapter as any).globalState;
      const schoolState = (adapter as any).schoolStates.get('school-x');
      expect(globalState).toBeDefined();
      expect(schoolState).toBeDefined();
      const reducedGlobal = globalState.current;
      expect(reducedGlobal).toBeLessThan(Number(process.env.SPEECHMATICS_MAX_CONCURRENCY));
      const reducedSchool = schoolState.current;
      expect(reducedSchool).toBeLessThan(Number(process.env.SPEECHMATICS_PER_SCHOOL_CONCURRENCY));

      // Simulate cooldown expiration for recovery
      globalState.lastErrorAt -= 10 * 60 * 1000;
      globalState.lastAdjustAt -= 10 * 60 * 1000;
      if (schoolState) {
        schoolState.lastErrorAt -= 10 * 60 * 1000;
        schoolState.lastAdjustAt -= 10 * 60 * 1000;
      }

      responses = [
        createResponse({ status: 201, data: { job: { id: 'job-ok', status: 'running' } } }),
        createResponse({ status: 200, data: { job: { id: 'job-ok', status: 'done' } } }),
        createResponse({ status: 200, data: { results: [{ alternatives: [{ text: 'recover' }] }] } }),
      ];

      await adapter.transcribeBuffer(Buffer.from('def'), 'audio/webm', {}, 'school-x');

      const recoveredGlobal = (adapter as any).globalState.current;
      const recoveredSchool = (adapter as any).schoolStates.get('school-x')?.current;
      expect(recoveredGlobal).toBeGreaterThanOrEqual(reducedGlobal);
      expect(recoveredSchool).toBeGreaterThanOrEqual(reducedSchool || 0);
    });
  });

  it('returns mock when STT_FORCE_MOCK=1', async () => {
    process.env.STT_FORCE_MOCK = '1';

    const request = jest.fn();
    const adapter = new SpeechmaticsSttAdapter({ http: { request } as any });

    const result = await adapter.transcribeBuffer(Buffer.from('abc'), 'audio/webm', { durationSeconds: 10 }, 'school-x');

    expect(result.text).toContain('mock transcription');
    expect(request).not.toHaveBeenCalled();
  });

  it('submits job, polls, and returns transcript', async () => {
    const responses = [
      createResponse({ status: 201, data: { job: { id: 'job-123', status: 'running' } } }),
      createResponse({ status: 200, data: { job: { id: 'job-123', status: 'done', duration: 4, language: 'en' } } }),
      createResponse({
        status: 200,
        data: {
          results: [
            { alternatives: [{ content: 'hello' }] },
            { alternatives: [{ content: [{ text: 'world' }] }] },
          ],
        },
      }),
    ];

    const request = jest.fn(async () => {
      const next = responses.shift();
      if (!next) {
        throw new Error('No response queued');
      }
      return {
        status: next.status,
        data: next.data,
        headers: next.headers || {},
        statusText: 'OK',
        config: {},
        request: {},
      };
    });

    const adapter = new SpeechmaticsSttAdapter({ http: { request } as any });
    const result = await adapter.transcribeBuffer(Buffer.from('abc'), 'audio/webm', { durationSeconds: 4, language: 'en' }, 'school-1');

    expect(result.text).toBe('hello world');
    expect(result.language).toBe('en');
    expect(result.duration).toBe(4);
    expect(request).toHaveBeenCalledTimes(3);

    const statusCounter = client.register.getSingleMetric('speechmatics_status_total');
    expect(statusCounter).toBeDefined();
    const statusMetric = statusCounter ? await statusCounter.get() : undefined;
    const statuses = (statusMetric?.values || []).map((entry: any) => entry.labels.status).sort();
    expect(statuses).toEqual(['200', '201']);
  });

  it('retries on 429 and records metrics', async () => {
    process.env.STT_TRANSCODE_TO_WAV = '0';

    const responses = [
      createResponse({ status: 429, data: { detail: 'rate limit' }, headers: { 'retry-after': '0.1' } }),
      createResponse({ status: 201, data: { job: { id: 'job-555', status: 'running' } } }),
      createResponse({ status: 200, data: { job: { id: 'job-555', status: 'done' } } }),
      createResponse({ status: 200, data: { results: [{ alternatives: [{ content: 'retry success' }] }] } }),
    ];

    const request = jest.fn(async () => {
      const next = responses.shift();
      if (!next) throw new Error('No response queued');
      return {
        status: next.status,
        data: next.data,
        headers: next.headers || {},
        statusText: 'OK',
        config: {},
        request: {},
      };
    });

    const adapter = new SpeechmaticsSttAdapter({ http: { request } as any });
    jest.spyOn(adapter as any, 'shouldForceWavBeforeSubmit').mockReturnValue(false);
    jest.spyOn(adapter as any, 'computeBackoff').mockReturnValue(0);

    const result = await adapter.transcribeBuffer(Buffer.from('abc'), 'audio/webm');

    expect(result.text).toBe('retry success');
    expect(request).toHaveBeenCalledTimes(4);

    const retriesCounter = client.register.getSingleMetric('speechmatics_retries_total');
    const retriesMetric = retriesCounter ? await retriesCounter.get() : undefined;
    const retriesValue = retriesMetric?.values?.[0]?.value || 0;
    expect(retriesValue).toBeGreaterThanOrEqual(1);

    const rateCounter = client.register.getSingleMetric('speechmatics_429_total');
    const rateMetric = rateCounter ? await rateCounter.get() : undefined;
    const rateValue = rateMetric?.values?.[0]?.value || 0;
    expect(rateValue).toBeGreaterThanOrEqual(1);
  });

  it('falls back to WAV on 400 when enabled', async () => {
    process.env.STT_TRANSCODE_TO_WAV = '1';
    process.env.SPEECHMATICS_FORCE_WAV = '0';

    const responses = [
      createResponse({ status: 400, data: { detail: 'invalid audio' } }),
      createResponse({ status: 201, data: { job: { id: 'job-900', status: 'running' } } }),
      createResponse({ status: 200, data: { job: { id: 'job-900', status: 'done' } } }),
      createResponse({ status: 200, data: { results: [{ alternatives: [{ content: [{ text: 'wav' }, { text: 'success' }] }] }] } }),
    ];

    const request = jest.fn(async () => {
      const next = responses.shift();
      if (!next) throw new Error('No response queued');
      return {
        status: next.status,
        data: next.data,
        headers: next.headers || {},
        statusText: 'OK',
        config: {},
        request: {},
      };
    });

    const adapter = new SpeechmaticsSttAdapter({ http: { request } as any });
    jest.spyOn(adapter as any, 'computeBackoff').mockReturnValue(0);

    await expect(adapter.transcribeBuffer(Buffer.from('abc'), 'audio/webm')).rejects.toThrow('Speechmatics request failed with status 400');
    expect(mockMaybeTranscodeToWav).toHaveBeenCalled();
  });
});

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import Bottleneck from 'bottleneck';
import FormData = require('form-data');
import * as client from 'prom-client';
import { logger } from '../utils/logger';
import type { SpeechToTextPort } from '../services/stt.port';
import { maybeTranscodeToWav } from '../services/audio/transcode.util';
import { sttBudgetService } from '../services/stt.budget.service';

const SPEECHMATICS_PROVIDER_LABEL = { provider: 'speechmatics' } as const;

type SpeechmaticsJobStatus = 'queued' | 'processing' | 'done' | 'rejected' | 'expired' | string;

type SpeechmaticsJobInfo = {
  id: string;
  status: SpeechmaticsJobStatus;
  duration?: number;
  language?: string;
  metadata?: {
    created_at?: string;
  };
};

type SpeechmaticsJobResponse = {
  job: SpeechmaticsJobInfo;
};

type SpeechmaticsTranscriptAlternative = {
  text?: string;
};

type SpeechmaticsTranscriptSection = {
  alternatives?: SpeechmaticsTranscriptAlternative[];
};

type SpeechmaticsTranscriptResponse = {
  results?: SpeechmaticsTranscriptSection[];
};

type RetryDecision = 'continue' | 'fallback-to-wav' | 'halt';

interface SpeechmaticsAdapterDeps {
  http?: AxiosInstance;
}

function getCounter(name: string, help: string, labelNames?: string[]) {
  const existing = client.register.getSingleMetric(name) as client.Counter<string> | undefined;
  if (existing) {
    return existing;
  }
  return new client.Counter({ name, help, ...(labelNames ? { labelNames } : {}) });
}

function getHistogram(name: string, help: string, buckets: number[], labelNames?: string[]) {
  const existing = client.register.getSingleMetric(name) as client.Histogram<string> | undefined;
  if (existing) {
    return existing;
  }
  return new client.Histogram({ name, help, buckets, ...(labelNames ? { labelNames } : {}) });
}

function getGauge(name: string, help: string, labelNames?: string[]) {
  const existing = client.register.getSingleMetric(name) as client.Gauge<string> | undefined;
  if (existing) {
    return existing;
  }
  return new client.Gauge({ name, help, ...(labelNames ? { labelNames } : {}) });
}

function parseRetryAfterMs(headerValue?: string | null): number | undefined {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  if (!trimmed) return undefined;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.max(0, Math.round(Number(trimmed) * 1000));
  }
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }
  return undefined;
}

export class SpeechmaticsSttAdapter implements SpeechToTextPort {
  private readonly http: AxiosInstance;
  private readonly globalLimiter: Bottleneck;
  private readonly schoolLimiters = new Map<string, Bottleneck>();
  private readonly concurrencyGauge = getGauge('stt_concurrency_current', 'Current STT concurrency limits', ['scope']);
  private readonly shapingEnabled = (process.env.CW_STT_SHAPING_ENABLED || process.env.SPEECHMATICS_SHAPING_ENABLED) === '1';
  private readonly penaltyPct = Number(process.env.SPEECHMATICS_SHAPING_PENALTY_PCT || 25);
  private readonly penaltyCooldownMs = Number(process.env.SPEECHMATICS_SHAPING_PENALTY_COOLDOWN_MS || 30000);
  private readonly recoveryMs = Number(process.env.SPEECHMATICS_SHAPING_RECOVER_MS || 300000);
  private readonly minGlobalConcurrency = Math.max(2, Number(process.env.SPEECHMATICS_MIN_GLOBAL_CONCURRENCY || 2));
  private readonly minPerSchoolConcurrency = Math.max(1, Number(process.env.SPEECHMATICS_MIN_PER_SCHOOL_CONCURRENCY || 1));
  private readonly globalState = { current: this.globalMaxConcurrency, lastErrorAt: 0, lastAdjustAt: 0, lastSuccessAt: Date.now() };
  private readonly schoolStates = new Map<string, { current: number; lastErrorAt: number; lastAdjustAt: number; lastSuccessAt: number }>();
  private readonly latencyHistogram = getHistogram(
    'speechmatics_latency_ms',
    'Latency from job submit to transcript fetch for Speechmatics',
    [200, 500, 1000, 2000, 4000, 8000, 12000]
  );
  private readonly providerLatencyHistogram = getHistogram(
    'stt_provider_latency_ms',
    'Latency from job submit to transcript fetch by provider',
    [200, 500, 1000, 2000, 4000, 8000, 12000],
    ['provider']
  );
  private readonly statusCounter = getCounter('speechmatics_status_total', 'HTTP status counts for Speechmatics requests', ['status']);
  private readonly retriesCounter = getCounter('speechmatics_retries_total', 'Total retries attempted for Speechmatics requests');
  private readonly tooManyRequestsCounter = getCounter('speechmatics_429_total', 'Total Speechmatics 429 responses');
  private readonly pollIterationsHistogram = getHistogram(
    'speechmatics_job_poll_iterations',
    'Number of poll iterations per Speechmatics job',
    [1, 2, 3, 5, 8, 13, 21]
  );

  constructor(deps?: SpeechmaticsAdapterDeps) {
    this.http = deps?.http ?? axios.create({ baseURL: this.baseUrl, timeout: this.requestTimeoutMs });
    this.globalLimiter = new Bottleneck({
      maxConcurrent: this.globalMaxConcurrency,
      minTime: 0,
    });
    this.concurrencyGauge.set({ scope: 'global' }, this.globalState.current);
    this.concurrencyGauge.set({ scope: 'school' }, this.perSchoolMaxConcurrency);
  }

  async transcribeBuffer(
    buf: Buffer,
    mime: string,
    options: { durationSeconds?: number; language?: string } = {},
    schoolId?: string
  ) {
    if (process.env.STT_FORCE_MOCK === '1') {
      return { text: 'mock transcription (Speechmatics forced)', confidence: 0.95, language: options.language, duration: options.durationSeconds };
    }
    if (process.env.NODE_ENV === 'test') {
      return { text: 'mock transcription (Speechmatics test)', confidence: 0.95, language: options.language, duration: options.durationSeconds };
    }

    const apiKey = this.apiKey;
    if (!apiKey) {
      if (process.env.NODE_ENV === 'development') {
        return { text: 'mock transcription (Speechmatics dev)', confidence: 0.9, language: options.language, duration: options.durationSeconds };
      }
      throw new Error('SPEECHMATICS_API_KEY is not configured');
    }

    const limiter = this.getLimiter(schoolId);

    const start = Date.now();
    const stopProviderTimer = this.providerLatencyHistogram.startTimer();

    try {
      const result = await limiter.schedule(() => this.transcribeWithRetries(buf, mime, options, apiKey, schoolId));
      const elapsed = Date.now() - start;
      this.latencyHistogram.observe(elapsed);
      this.observeShaping({ schoolId, success: true });
      return result;
    } finally {
      stopProviderTimer(SPEECHMATICS_PROVIDER_LABEL);
    }
  }

  private async transcribeWithRetries(
    originalBuffer: Buffer,
    originalMime: string,
    options: { durationSeconds?: number; language?: string } = {},
    apiKey: string,
    schoolId?: string
  ) {
    const maxAttempts = 4; // 1 initial attempt + 3 retries
    let attempt = 0;
    let buffer = originalBuffer;
    let mime = originalMime;
    let fallbackUsed = false;

    if (this.shouldForceWavBeforeSubmit(originalMime)) {
      logger.info('speechmatics.force_wav_pre_submit.begin', {
        normalizedMime: this.normalizeMime(originalMime),
        sizeBytes: buffer.length,
      });
      try {
        const forced = await maybeTranscodeToWav(buffer, mime, { force: true });
        buffer = forced.buffer;
        mime = forced.mime;
        fallbackUsed = true;
        logger.info('speechmatics.force_wav_pre_submit.success', {
          resultMime: mime,
          sizeBytes: buffer.length,
        });
      } catch (error) {
        logger.warn('speechmatics.force_wav_pre_submit_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    let lastError: unknown;

    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        return await this.executeJob(buffer, mime, options, apiKey, schoolId);
      } catch (error) {
        this.observeShaping({ schoolId, success: false, error });
        lastError = error;
        const status = (error as any)?.status as number | undefined;
        const retryAfter = (error as any)?.retryAfterMs as number | undefined;
        const decision = await this.decideRetry(error, fallbackUsed, attempt, maxAttempts);

        if (decision === 'fallback-to-wav') {
          try {
            const transcoded = await maybeTranscodeToWav(buffer, mime, { force: true });
            buffer = transcoded.buffer;
            mime = transcoded.mime;
            fallbackUsed = true;
            logger.info('speechmatics.retry_wav_fallback.success', {
              attempt,
              mime,
              sizeBytes: buffer.length,
            });
            continue;
          } catch (transcodeError) {
            logger.warn('speechmatics.transcode_fallback_failed', {
              error: transcodeError instanceof Error ? transcodeError.message : String(transcodeError),
            });
            throw error;
          }
        }

        if (decision === 'continue') {
          this.retriesCounter.inc();
          const waitMs = this.computeBackoff(attempt, status, retryAfter);
          if (status === 429) {
            this.tooManyRequestsCounter.inc();
          }
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }

        throw error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Speechmatics transcription failed');
  }

  private async executeJob(
    buffer: Buffer,
    mime: string,
    options: { durationSeconds?: number; language?: string },
    apiKey: string,
    schoolId?: string
  ) {
    const prepared = await this.createJob(buffer, mime, options, apiKey);
    const jobId = prepared.id;
    logger.debug('speechmatics.job.created', { jobId, language: options.language, operatingPoint: process.env.SPEECHMATICS_OPERATING_POINT || 'enhanced' });

    const deadline = Date.now() + this.resolveJobTimeout(options.durationSeconds);
    const job = await this.pollJob(jobId, deadline, apiKey);

    const transcript = await this.fetchTranscript(jobId, apiKey);
    try {
      const preview = JSON.stringify(transcript)?.slice(0, 2000);
      logger.debug('speechmatics.transcript_raw', { jobId, preview });
    } catch {}
    const text = this.extractTranscriptText(transcript);
    logger.debug('speechmatics.transcript_text', {
      jobId,
      length: text.length,
      textPreview: text.slice(0, 120),
    });
    if (this.deleteAfterFetch) {
      await this.deleteJob(jobId, apiKey);
    }

    const duration = job?.duration ?? options.durationSeconds;
    try {
      logger.debug('speechmatics.job.completed', {
        jobId,
        status: job?.status,
        duration,
        language: job?.language,
      });
      await sttBudgetService.recordUsage({ schoolId, durationSeconds: duration, provider: 'speechmatics' });
    } catch {
      // ignore budget tracking errors
    }

    return {
      text,
      language: job?.language,
      duration,
    };
  }

  private async createJob(
    buffer: Buffer,
    mime: string,
    options: { durationSeconds?: number; language?: string },
    apiKey: string
  ) {
    const configPayload = {
      type: 'transcription',
      transcription_config: this.buildTranscriptionConfig(options),
    };

    const form = new FormData();
    form.append('config', JSON.stringify(configPayload));
    const filename = this.filenameForMime(mime);
    form.append('data_file', buffer, { filename, contentType: this.normalizeMime(mime) });

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      ...form.getHeaders(),
    };

    const response = await this.request<any>({
      method: 'POST',
      url: '/jobs',
      data: form,
      headers,
    });

    const payload = response.data as { job?: SpeechmaticsJobInfo; id?: string; status?: SpeechmaticsJobStatus };
    const job = payload?.job;
    const id = job?.id ?? payload?.id;
    if (!id) {
      throw Object.assign(new Error('Speechmatics job creation failed: missing id'), { status: response.status, body: payload });
    }

    if (job) return job;
    return {
      id,
      status: payload?.status ?? 'queued',
    } satisfies SpeechmaticsJobInfo;
  }

  private async pollJob(jobId: string, deadline: number, apiKey: string) {
    const pollIntervalMs = this.pollIntervalMs;
    let iterations = 0;

    while (Date.now() < deadline) {
      iterations += 1;
      const response = await this.request<SpeechmaticsJobResponse>({
        method: 'GET',
        url: `/jobs/${jobId}`,
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      const job = response.data?.job;
      const status = job?.status;
      logger.debug('speechmatics.job.poll', { jobId, status, iterations });
      if (status === 'done') {
        this.pollIterationsHistogram.observe(iterations);
        return job;
      }
      if (status === 'rejected' || status === 'expired') {
        throw Object.assign(new Error(`Speechmatics job ${status}`), { status: response.status });
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw Object.assign(new Error('Speechmatics job polling timed out'), { status: 504 });
  }

  private async fetchTranscript(jobId: string, apiKey: string) {
    const response = await this.request<SpeechmaticsTranscriptResponse>({
      method: 'GET',
      url: `/jobs/${jobId}/transcript`,
      params: { format: 'json-v2' },
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/vnd.speechmatics.v2+json' },
    });
    return response.data;
  }

  private async deleteJob(jobId: string, apiKey: string) {
    try {
      await this.request({
        method: 'DELETE',
        url: `/jobs/${jobId}`,
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    } catch (error) {
      logger.debug('speechmatics.delete_job_failed', {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async request<T>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    const requestConfig: AxiosRequestConfig = {
      timeout: this.requestTimeoutMs,
      baseURL: this.baseUrl,
      validateStatus: () => true,
      ...config,
    };

    try {
      const response = await this.http.request<T>(requestConfig);
      const statusLabel = { status: String(response.status) };
      this.statusCounter.inc(statusLabel);

      if (response.status >= 200 && response.status < 300) {
        return response;
      }

      const retryAfterMs = parseRetryAfterMs(response.headers?.['retry-after']);
      logger.warn('speechmatics.request.error', {
        status: response.status,
        endpoint: requestConfig.url,
        response: response.data,
      });
      const error = Object.assign(
        new Error(`Speechmatics request failed with status ${response.status}`),
        { status: response.status, retryAfterMs, response: response.data }
      );
      throw error;
    } catch (error) {
      if ((error as any)?.isAxiosError && (error as any)?.response) {
        throw error;
      }
      throw Object.assign(
        error instanceof Error ? error : new Error('Speechmatics request failed'),
        { status: (error as any)?.status }
      );
    }
  }

  private async decideRetry(error: unknown, fallbackUsed: boolean, attempt: number, maxAttempts: number): Promise<RetryDecision> {
    const status = (error as any)?.status as number | undefined;

    if (status === 400 && !fallbackUsed && this.allowWavFallback) {
      return 'fallback-to-wav';
    }

    if (status === 429 || (status !== undefined && status >= 500 && status < 600)) {
      if (attempt < maxAttempts) {
        return 'continue';
      }
      return 'halt';
    }

    if (!status && attempt < maxAttempts) {
      return 'continue';
    }

    return 'halt';
  }

  private computeBackoff(attempt: number, status?: number, retryAfter?: number) {
    const base = 500 * Math.pow(2, attempt - 1);
    const jitter = Math.floor(Math.random() * 250);
    const capped = Math.min(base, 8000) + jitter;
    if (retryAfter && retryAfter > 0) {
      return Math.max(capped, retryAfter);
    }
    if (status === 429) {
      return capped + 250; // small additive cushion on rate limits
    }
    return capped;
  }

  private getLimiter(schoolId?: string): Bottleneck {
    if (!schoolId) return this.globalLimiter;
    return this.getSchoolLimiter(schoolId);
  }

  private getSchoolState(schoolId: string) {
    let state = this.schoolStates.get(schoolId);
    if (!state) {
      state = { current: this.perSchoolMaxConcurrency, lastErrorAt: 0, lastAdjustAt: 0, lastSuccessAt: Date.now() };
      this.schoolStates.set(schoolId, state);
    }
    return state;
  }

  private setGlobalConcurrency(value: number) {
    const clamped = Math.max(this.minGlobalConcurrency, Math.min(this.globalMaxConcurrency, Math.floor(value) || this.minGlobalConcurrency));
    if (clamped === this.globalState.current) return;
    this.globalState.current = clamped;
    this.globalLimiter.updateSettings({ maxConcurrent: clamped });
    this.concurrencyGauge.set({ scope: 'global' }, clamped);
  }

  private setSchoolConcurrency(schoolId: string, value: number) {
    const state = this.getSchoolState(schoolId);
    const clamped = Math.max(this.minPerSchoolConcurrency, Math.min(this.perSchoolMaxConcurrency, Math.floor(value) || this.minPerSchoolConcurrency));
    if (clamped === state.current) return;
    state.current = clamped;
    const limiter = this.schoolLimiters.get(schoolId);
    if (limiter) limiter.updateSettings({ maxConcurrent: clamped });
    this.concurrencyGauge.set({ scope: 'school' }, clamped);
  }

  private observeShaping(event: { schoolId?: string; success?: boolean; error?: unknown }) {
    if (!this.shapingEnabled) return;
    const now = Date.now();

    if (event.success) {
      this.recoverGlobal(now);
      if (event.schoolId) this.recoverSchool(event.schoolId, now);
      return;
    }

    const status = this.extractStatus(event.error);
    if (!status) return;
    if (status === 429 || status >= 500) {
      this.reduceGlobal(now);
      if (event.schoolId) this.reduceSchool(event.schoolId, now);
    }
  }

  private extractStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const maybe = (error as any).status ?? (error as any).response?.status;
    return typeof maybe === 'number' ? maybe : undefined;
  }

  private reduceGlobal(now: number) {
    if (now - this.globalState.lastAdjustAt < this.penaltyCooldownMs) return;
    const current = this.globalState.current;
    let next = Math.floor(current * (1 - this.penaltyPct / 100));
    if (next >= current) next = current - 1;
    this.setGlobalConcurrency(next);
    this.globalState.lastAdjustAt = now;
    this.globalState.lastErrorAt = now;
  }

  private reduceSchool(schoolId: string, now: number) {
    const state = this.getSchoolState(schoolId);
    if (now - state.lastAdjustAt < this.penaltyCooldownMs) return;
    let next = Math.floor(state.current * (1 - this.penaltyPct / 100));
    if (next >= state.current) next = state.current - 1;
    this.setSchoolConcurrency(schoolId, next);
    state.lastAdjustAt = now;
    state.lastErrorAt = now;
  }

  private recoverGlobal(now: number) {
    if (this.globalState.current >= this.globalMaxConcurrency) return;
    if (now - this.globalState.lastErrorAt < this.recoveryMs) return;
    this.setGlobalConcurrency(this.globalState.current + 1);
    this.globalState.lastAdjustAt = now;
    this.globalState.lastSuccessAt = now;
  }

  private recoverSchool(schoolId: string, now: number) {
    const state = this.getSchoolState(schoolId);
    if (state.current >= this.perSchoolMaxConcurrency) return;
    if (now - state.lastErrorAt < this.recoveryMs) return;
    this.setSchoolConcurrency(schoolId, state.current + 1);
    state.lastAdjustAt = now;
    state.lastSuccessAt = now;
  }

  private buildTranscriptionConfig(options: { durationSeconds?: number; language?: string }) {
    const operatingPoint = process.env.SPEECHMATICS_OPERATING_POINT || 'enhanced';
    const config: Record<string, unknown> = {
      operating_point: operatingPoint,
    };

    const language = this.resolveLanguage(options.language);
    if (language) {
      config.language = language;
    }

    const punctuationSensitivity = process.env.SPEECHMATICS_PUNCTUATION_SENSITIVITY;
    if (punctuationSensitivity) {
      const value = Number(punctuationSensitivity);
      if (!Number.isNaN(value)) {
        config.punctuation_overrides = { sensitivity: Math.min(Math.max(value, 0), 1) };
      }
    }

    return config;
  }

  private extractTranscriptText(response: SpeechmaticsTranscriptResponse): string {
    if (!Array.isArray(response?.results)) {
      return '';
    }

    const segments: string[] = [];

    for (const section of response.results) {
      const alternatives = Array.isArray(section?.alternatives) ? section!.alternatives! : [];
      for (const alternative of alternatives) {
        const directText = (alternative?.text || '').trim();
        if (directText) {
          segments.push(directText);
          continue;
        }

        const altContent = (alternative as any)?.content;
        if (typeof altContent === 'string') {
          const piece = altContent.trim();
          if (piece) {
            segments.push(piece);
          }
        } else if (Array.isArray(altContent)) {
          for (const item of altContent) {
            const piece = typeof item?.text === 'string' ? item.text.trim() : '';
            if (piece) {
              segments.push(piece);
            }
          }
        }
      }
    }

    return segments.join(' ').replace(/\s+/g, ' ').trim();
  }

  private getSchoolLimiter(schoolId: string) {
    const existing = this.schoolLimiters.get(schoolId);
    if (existing) return existing;

    const state = this.getSchoolState(schoolId);
    const limiter = new Bottleneck({
      maxConcurrent: state.current,
      minTime: 0,
    });
    this.schoolLimiters.set(schoolId, limiter);
    return limiter;
  }

  private normalizeMime(mime: string) {
    const mt = (mime || '').toLowerCase();
    if (mt.startsWith('audio/ogg') || mt.startsWith('application/ogg')) return 'audio/ogg';
    if (mt.startsWith('audio/wav') || mt.startsWith('audio/x-wav')) return 'audio/wav';
    if (mt.startsWith('audio/mpeg') || mt.startsWith('audio/mp3')) return 'audio/mpeg';
    if (mt.startsWith('audio/mp4')) return 'audio/mp4';
    if (mt.startsWith('audio/mpga')) return 'audio/mpga';
    if (mt.startsWith('audio/webm')) return 'audio/webm';
    return 'application/octet-stream';
  }

  private filenameForMime(mime: string) {
    const mt = this.normalizeMime(mime);
    if (mt === 'audio/ogg') return 'audio.ogg';
    if (mt === 'audio/wav') return 'audio.wav';
    if (mt === 'audio/mpeg') return 'audio.mp3';
    if (mt === 'audio/mp4') return 'audio.mp4';
    if (mt === 'audio/mpga') return 'audio.mpga';
    if (mt === 'audio/webm') return 'audio.webm';
    return 'audio.bin';
  }

  private get baseUrl() {
    return process.env.SPEECHMATICS_BASE_URL || 'https://asr.api.speechmatics.com/v2';
  }

  private get apiKey() {
    return process.env.SPEECHMATICS_API_KEY || '';
  }

  private get requestTimeoutMs() {
    return Number(process.env.SPEECHMATICS_TIMEOUT_MS || '15000');
  }

  private get pollIntervalMs() {
    return Number(process.env.SPEECHMATICS_POLL_INTERVAL_MS || '1000');
  }

  private resolveJobTimeout(durationSeconds?: number) {
    const envValue = process.env.SPEECHMATICS_JOB_TIMEOUT_MS;
    if (envValue) {
      const parsed = Number(envValue);
      if (!Number.isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
    const base = durationSeconds && durationSeconds > 0 ? durationSeconds * 2000 : 20000;
    return Math.max(8000, Math.min(base, 30000));
  }

  private get globalMaxConcurrency() {
    return Number(process.env.SPEECHMATICS_MAX_CONCURRENCY || '8');
  }

  private get perSchoolMaxConcurrency() {
    return Number(process.env.SPEECHMATICS_PER_SCHOOL_CONCURRENCY || '2');
  }

  private get languageHint() {
    const hint = (process.env.STT_LANGUAGE_HINT || '').trim();
    return hint || undefined;
  }

  private get languageMode(): 'hint' | 'auto' | 'fixed' {
    const raw = (process.env.STT_LANGUAGE_MODE || 'hint').toLowerCase();
    if (raw === 'auto') return 'auto';
    if (raw === 'fixed') return 'fixed';
    return 'hint';
  }

  private resolveLanguage(explicit?: string): string | undefined {
    const mode = this.languageMode;
    if (mode === 'auto') return undefined;

    const envHint = (this.languageHint || '').trim();
    const explicitHint = (explicit || '').trim();

    if (mode === 'fixed') {
      const choice = envHint || explicitHint;
      if (!choice) {
        logger.warn('speechmatics.language_mode.fixed_missing_hint');
        return undefined;
      }
      return choice;
    }

    const candidate = explicitHint || envHint;
    return candidate || undefined;
  }

  private get allowWavFallback() {
    return process.env.STT_TRANSCODE_TO_WAV === '1' || process.env.SPEECHMATICS_ALLOW_WAV_FALLBACK === '1';
  }

  private get forceWavBeforeSubmit() {
    return process.env.SPEECHMATICS_FORCE_WAV === '1';
  }

  private shouldForceWavBeforeSubmit(mime: string) {
    if (this.forceWavBeforeSubmit) return true;
    return this.normalizeMime(mime) === 'audio/webm';
  }

  private get deleteAfterFetch() {
    return process.env.SPEECHMATICS_DELETE_AFTER_FETCH === '1';
  }
}

export const speechmaticsSttAdapter = new SpeechmaticsSttAdapter();

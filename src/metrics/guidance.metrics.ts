import * as client from 'prom-client';

function getOrCreateCounter<TLabelNames extends readonly string[]>(
  name: string,
  help: string,
  labelNames: TLabelNames
): client.Counter<TLabelNames[number]> {
  const existing = client.register.getSingleMetric(name) as client.Counter<TLabelNames[number]> | undefined;
  if (existing) {
    return existing;
  }
  return new client.Counter({ name, help, labelNames });
}

function getOrCreateHistogram<TLabelNames extends readonly string[]>(
  name: string,
  help: string,
  buckets: number[],
  labelNames: TLabelNames
): client.Histogram<TLabelNames[number]> {
  const existing = client.register.getSingleMetric(name) as client.Histogram<TLabelNames[number]> | undefined;
  if (existing) {
    return existing;
  }
  return new client.Histogram({ name, help, buckets, labelNames });
}

function getOrCreateGauge<TLabelNames extends readonly string[]>(
  name: string,
  help: string,
  labelNames: TLabelNames
): client.Gauge<TLabelNames[number]> {
  const existing = client.register.getSingleMetric(name) as client.Gauge<TLabelNames[number]> | undefined;
  if (existing) {
    return existing;
  }
  return new client.Gauge({ name, help, labelNames });
}

export function getGuidancePromptActionCounter() {
  return getOrCreateCounter('guidance_prompt_action_total', 'Total prompt interactions by action', ['action'] as const);
}

export function getGuidanceOnTrackSummaryEmittedCounter() {
  return getOrCreateCounter(
    'guidance_ontrack_summary_emitted_total',
    'Total on-track summaries emitted to teachers',
    ['sessionId', 'groupId'] as const
  );
}

export function getGuidanceOnTrackSummarySuppressedCounter() {
  return getOrCreateCounter(
    'guidance_ontrack_summary_suppressed_total',
    'On-track summary suppressions by reason',
    ['reason'] as const
  );
}

export function getGuidanceContextParaphraseCounter() {
  return getOrCreateCounter(
    'guidance_context_paraphrase_total',
    'Paraphrased context generation results by summarization path',
    ['path', 'result'] as const
  );
}

const CONTEXT_SUMMARY_BUCKETS = [40, 80, 120, 160];

export function getGuidanceContextSummaryLengthHistogram() {
  return getOrCreateHistogram(
    'guidance_context_summary_length_chars',
    'Length of paraphrased context reason field',
    CONTEXT_SUMMARY_BUCKETS,
    [] as const
  );
}

const CONTEXT_QUALITY_BUCKETS = [0.2, 0.4, 0.6, 0.8, 1];

export function getGuidanceContextQualityHistogram() {
  return getOrCreateHistogram(
    'guidance_context_quality_score_bucket',
    'Quality score distribution for guidance context paraphrases',
    CONTEXT_QUALITY_BUCKETS,
    [] as const
  );
}

const EPISODE_COUNT_BUCKETS = [1, 2, 3, 4, 6, 8];

export function getGuidanceEpisodeCountHistogram() {
  return getOrCreateHistogram(
    'guidance_context_episode_count',
    'Episode count considered for guidance context selection',
    EPISODE_COUNT_BUCKETS,
    [] as const
  );
}

const EPISODE_SELECTION_LATENCY_BUCKETS = [5, 10, 20, 35, 50, 80, 120, 200, 400];

export function getGuidanceContextSelectionLatencyHistogram() {
  return getOrCreateHistogram(
    'guidance_context_selection_latency_ms',
    'Latency for constructing episode-aware guidance windows',
    EPISODE_SELECTION_LATENCY_BUCKETS,
    [] as const
  );
}

const DRIFT_PERSISTENCE_BUCKETS = [5, 10, 20, 30, 45, 60, 90, 120];

export function getGuidanceDriftPersistenceHistogram() {
  return getOrCreateHistogram(
    'guidance_drift_persistence_seconds',
    'Duration that drift persisted before gating prompted action',
    DRIFT_PERSISTENCE_BUCKETS,
    [] as const
  );
}

const ALIGNMENT_DELTA_BUCKETS = [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.6, 0.8, 1];

export function getGuidanceContextAlignmentDeltaHistogram() {
  return getOrCreateHistogram(
    'guidance_context_alignment_delta',
    'Alignment delta between aligned and current guidance episodes',
    ALIGNMENT_DELTA_BUCKETS,
    [] as const
  );
}

export function getGuidanceRedisUnavailableCounter() {
  return getOrCreateCounter(
    'guidance_redis_unavailable_total',
    'Redis unavailable occurrences per guidance component',
    ['component'] as const
  );
}

const PROMPT_ACTION_BUCKETS = [1000, 3000, 5000, 10000, 20000, 30000, 45000, 60000, 120000];

export function getGuidanceTimeToFirstActionHistogram() {
  return getOrCreateHistogram(
    'guidance_time_to_first_action_ms',
    'Latency between prompt emit and first interaction',
    PROMPT_ACTION_BUCKETS,
    [] as const
  );
}

export function getGuidanceWsSubscribersGauge() {
  return getOrCreateGauge(
    'guidance_ws_subscribers',
    'Current number of active guidance websocket subscribers per session',
    ['sessionId'] as const
  );
}

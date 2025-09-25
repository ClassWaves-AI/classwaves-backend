import fs from 'fs';
import path from 'path';

type MetricName =
  | 'guidance_context_episode_count'
  | 'guidance_context_selection_latency_ms'
  | 'guidance_drift_persistence_seconds'
  | 'guidance_context_alignment_delta';

const METRICS_OF_INTEREST = new Set<MetricName>([
  'guidance_context_episode_count',
  'guidance_context_selection_latency_ms',
  'guidance_drift_persistence_seconds',
  'guidance_context_alignment_delta',
]);

type SnapshotDiffSeverity = 'info' | 'warn';

const SUM_TOLERANCE: Record<MetricName, number> = {
  guidance_context_episode_count: 1e-6,
  guidance_context_selection_latency_ms: 5,
  guidance_drift_persistence_seconds: 1e-6,
  guidance_context_alignment_delta: 1e-6,
};

const DEFAULT_SNAPSHOT_DIRECTORY = path.resolve(
  process.cwd(),
  'src/__tests__/integration/guidance/fixtures/metrics'
);

export interface HistogramBucketSnapshot {
  upperBound: string;
  count: number;
}

export interface HistogramSnapshot {
  count: number;
  sum: number;
  buckets: HistogramBucketSnapshot[];
}

export type FixtureMetricsSnapshot = Record<MetricName | string, HistogramSnapshot>;

export type PrometheusMetricSnapshot = {
  name: string;
  type: 'histogram' | string;
  values: Array<{
    metricName: string;
    labels?: Record<string, string>;
    value: number;
  }>;
};

export interface GuidanceMetricsBaselineOptions {
  rootDir?: string;
}

interface VerifyOptions extends GuidanceMetricsBaselineOptions {
  allowWrite?: boolean;
}

function resolveSnapshotDirectory(options?: GuidanceMetricsBaselineOptions): string {
  return options?.rootDir ?? DEFAULT_SNAPSHOT_DIRECTORY;
}

function ensureDirectoryExists(directory: string): void {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function snapshotFilePath(
  fixtureId: string,
  options?: GuidanceMetricsBaselineOptions
): string {
  const directory = resolveSnapshotDirectory(options);
  return path.join(directory, `${fixtureId}.metrics.json`);
}

export function normaliseSnapshot(snapshot: FixtureMetricsSnapshot): FixtureMetricsSnapshot {
  const orderedMetricNames = Object.keys(snapshot).sort();
  return orderedMetricNames.reduce<FixtureMetricsSnapshot>((acc, name) => {
    const metric = snapshot[name];
    if (!metric) {
      return acc;
    }
    acc[name] = {
      count: metric.count,
      sum: metric.sum,
      buckets: [...metric.buckets]
        .map((bucket) => ({
          upperBound: bucket.upperBound.toString(),
          count: bucket.count,
        }))
        .sort((a, b) => {
          if (a.upperBound === b.upperBound) return 0;
          if (a.upperBound === '+Inf') return 1;
          if (b.upperBound === '+Inf') return -1;
          return Number(a.upperBound) - Number(b.upperBound);
        }),
    };
    return acc;
  }, {});
}

function readSnapshotFile(filePath: string): FixtureMetricsSnapshot {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as FixtureMetricsSnapshot;
}

export function captureGuidanceMetricsSnapshot(
  metrics: PrometheusMetricSnapshot[],
  options?: { includeAllMetrics?: boolean }
): FixtureMetricsSnapshot {
  const snapshot: FixtureMetricsSnapshot = {};

  for (const metric of metrics) {
    const metricName = metric.name as MetricName | string;
    const shouldCapture =
      options?.includeAllMetrics === true ||
      (METRICS_OF_INTEREST.has(metricName as MetricName) && metric.type === 'histogram');

    if (!shouldCapture) {
      continue;
    }

    const buckets: HistogramBucketSnapshot[] = [];
    let sum = 0;
    let count = 0;

    for (const value of metric.values) {
      if (value.metricName.endsWith('_bucket')) {
        buckets.push({
          upperBound: value.labels?.le ?? '+Inf',
          count: Number(value.value),
        });
      } else if (value.metricName.endsWith('_sum')) {
        sum = Number(value.value);
      } else if (value.metricName.endsWith('_count')) {
        count = Number(value.value);
      }
    }

    buckets.sort((a, b) => {
      if (a.upperBound === b.upperBound) return 0;
      if (a.upperBound === '+Inf') return 1;
      if (b.upperBound === '+Inf') return -1;
      return Number(a.upperBound) - Number(b.upperBound);
    });

    snapshot[metricName] = { count, sum, buckets };
  }

  return snapshot;
}

export function guidanceMetricsBaselineExists(
  fixtureId: string,
  options?: GuidanceMetricsBaselineOptions
): boolean {
  const filePath = snapshotFilePath(fixtureId, options);
  return fs.existsSync(filePath);
}

export function readGuidanceMetricsBaseline(
  fixtureId: string,
  options?: GuidanceMetricsBaselineOptions
): FixtureMetricsSnapshot | null {
  const filePath = snapshotFilePath(fixtureId, options);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return readSnapshotFile(filePath);
}

export function writeGuidanceMetricsBaseline(
  fixtureId: string,
  snapshot: FixtureMetricsSnapshot,
  options?: GuidanceMetricsBaselineOptions
): void {
  const directory = resolveSnapshotDirectory(options);
  ensureDirectoryExists(directory);

  const filePath = snapshotFilePath(fixtureId, options);
  const ordered = normaliseSnapshot(snapshot);
  fs.writeFileSync(filePath, `${JSON.stringify(ordered, null, 2)}\n`, 'utf-8');
}

export function diffGuidanceMetricsSnapshots(
  expected: FixtureMetricsSnapshot,
  actual: FixtureMetricsSnapshot
): string[] {
  const diffs: string[] = [];
  const allMetricNames = new Set([
    ...Object.keys(expected ?? {}),
    ...Object.keys(actual ?? {}),
  ]);

  for (const name of allMetricNames) {
    const baseline = expected?.[name];
    const current = actual?.[name];

    if (!baseline) {
      diffs.push(`Metric '${name}' missing from baseline.`);
      continue;
    }
    if (!current) {
      diffs.push(`Metric '${name}' missing from replay output.`);
      continue;
    }

    if (baseline.count !== current.count) {
      diffs.push(`'${name}' count mismatch (baseline ${baseline.count} vs current ${current.count}).`);
    }

    const tolerance = SUM_TOLERANCE[name as MetricName] ?? 1e-6;
    if (Math.abs(baseline.sum - current.sum) > tolerance) {
      diffs.push(
        `'${name}' sum mismatch (baseline ${baseline.sum} vs current ${current.sum}, tolerance ${tolerance}).`
      );
    }

    if (baseline.buckets.length !== current.buckets.length) {
      diffs.push(
        `'${name}' bucket length mismatch (baseline ${baseline.buckets.length} vs current ${current.buckets.length}).`
      );
      continue;
    }

    for (let index = 0; index < baseline.buckets.length; index += 1) {
      const expectedBucket = baseline.buckets[index];
      const actualBucket = current.buckets[index];
      if (expectedBucket.upperBound !== actualBucket.upperBound) {
        diffs.push(
          `'${name}' bucket ${index} bound mismatch (baseline ${expectedBucket.upperBound} vs current ${actualBucket.upperBound}).`
        );
      }
      if (expectedBucket.count !== actualBucket.count) {
        diffs.push(
          `'${name}' bucket ${index} count mismatch (baseline ${expectedBucket.count} vs current ${actualBucket.count}).`
        );
      }
    }
  }

  return diffs;
}

export function verifyGuidanceMetricsSnapshot(
  fixtureId: string,
  snapshot: FixtureMetricsSnapshot,
  options?: VerifyOptions
): void {
  const shouldAllowWrite =
    options?.allowWrite ?? process.env.GUIDANCE_FIXTURE_METRICS_SNAPSHOT === '1';

  const filePath = snapshotFilePath(fixtureId, options);
  const directory = resolveSnapshotDirectory(options);
  ensureDirectoryExists(directory);

  if (!fs.existsSync(filePath)) {
    if (shouldAllowWrite) {
      writeGuidanceMetricsBaseline(fixtureId, snapshot, options);
      console.warn(`[metrics] Created baseline for ${fixtureId} at ${relativePath(filePath)}`);
      return;
    }
    throw new Error(
      `Missing guidance metrics baseline for '${fixtureId}'. Run with GUIDANCE_FIXTURE_METRICS_SNAPSHOT=1 to record a new snapshot.`
    );
  }

  if (shouldAllowWrite) {
    writeGuidanceMetricsBaseline(fixtureId, snapshot, options);
    console.warn(`[metrics] Updated baseline for ${fixtureId} at ${relativePath(filePath)}`);
    return;
  }

  const baseline = readSnapshotFile(filePath);
  const diffs = diffGuidanceMetricsSnapshots(baseline, snapshot);

  if (diffs.length > 0) {
    const formatted = diffs.map((entry) => `- ${entry}`).join('\n');
    throw new Error(
      `Guidance metrics regression for fixture '${fixtureId}'. Differences:\n${formatted}\nIf intentional, rerun with GUIDANCE_FIXTURE_METRICS_SNAPSHOT=1 to refresh baselines.`
    );
  }
}

export function summariseGuidanceMetricsBaseline(
  snapshot: FixtureMetricsSnapshot
): Array<{
  metric: string;
  count: number;
  sum: number;
  severity: SnapshotDiffSeverity;
}> {
  return Object.entries(snapshot).map(([metric, value]) => ({
    metric,
    count: value.count,
    sum: value.sum,
    severity: 'info' as SnapshotDiffSeverity,
  }));
}

function relativePath(filePath: string): string {
  return path.relative(process.cwd(), filePath);
}

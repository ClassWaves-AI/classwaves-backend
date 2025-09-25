import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import type { GuidanceTranscriptLine } from '../services/ports/guidance-context.port';

const DEFAULT_FIXTURE_DIRECTORY = path.resolve(
  process.cwd(),
  'src/__tests__/integration/guidance/fixtures'
);

export type DriftProfile =
  | 'on_track'
  | 'light_drift'
  | 'heavy_drift'
  | 'recovery'
  | 'low_confidence'
  | 'mixed';

const transcriptLineSchema = z
  .object({
    text: z.string().min(1, 'Transcript text cannot be empty'),
    timestamp: z
      .number()
      .int('timestamp must be an integer')
      .nonnegative('timestamp must be positive'),
    speakerLabel: z.string().min(1).optional(),
    sequence: z.number().int().nonnegative().optional(),
    sttConfidence: z.number().min(0).max(1).optional(),
  })
  .transform((value) => ({
    ...value,
    speakerLabel: value.speakerLabel ? normaliseSpeaker(value.speakerLabel) : undefined,
  }));

const metricExpectationSchema = z.union([
  z.object({
    type: z.literal('exact'),
    value: z.number(),
  }),
  z.object({
    type: z.literal('approx'),
    value: z.number(),
    tolerance: z.number().nonnegative(),
  }),
  z.object({
    type: z.literal('min'),
    value: z.number(),
  }),
  z.object({
    type: z.literal('max'),
    value: z.number(),
  }),
]);

const tierWhySchema = z
  .object({
    alignmentDeltaMin: z.number().nonnegative().optional(),
    driftSecondsMin: z.number().nonnegative().optional(),
    inputQualityMax: z.number().min(0).max(1).optional(),
  })
  .strict()
  .optional();

const tier1ExpectationSchema = z
  .object({
    expectedPromptCount: z.number().int().min(0).optional(),
    expectedCategories: z.array(z.string().min(1)).optional(),
    gating: z
      .enum(['on_track', 'light_drift', 'heavy_drift', 'recovery', 'low_confidence', 'mixed'])
      .optional(),
    summaryIncludes: z.array(z.string().min(1)).optional(),
    suppressedReason: z.string().optional(),
    why: tierWhySchema,
  })
  .strict()
  .optional();

const tier2ExpectationSchema = z
  .object({
    expectedInsightCount: z.number().int().min(0).optional(),
    recommendationCategories: z.array(z.string().min(1)).optional(),
    summaryIncludes: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .optional();

const fixtureSchema = z
  .object({
    metadata: z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      description: z.string().min(1),
      goal: z.string().min(1).optional(),
      subject: z.string().min(1),
      gradeBand: z.string().min(1).optional(),
      domainTerms: z.array(z.string().min(1)).optional(),
      driftProfile: z.enum(['on_track', 'light_drift', 'heavy_drift', 'recovery', 'low_confidence', 'mixed']),
      driftNotes: z.string().optional(),
      tags: z.array(z.string().min(1)).default([]),
    }),
    featureFlags: z
      .object({
        cwGuidanceEpisodesEnabled: z.boolean().optional(),
        guidanceAutoPrompts: z.boolean().optional(),
      })
      .default({}),
    playback: z
      .object({
        msBetweenLines: z.number().int().positive().optional(),
        chunkSize: z.number().int().positive().optional(),
      })
      .default({}),
    expectations: z
      .object({
        tier1: tier1ExpectationSchema,
        tier2: tier2ExpectationSchema,
        metrics: z.record(z.string(), metricExpectationSchema).optional(),
      })
      .default({}),
    transcript: z.array(transcriptLineSchema).min(1, 'Fixtures must provide at least one transcript line'),
  })
  .strict();

export type GuidanceFixture = z.infer<typeof fixtureSchema>;
export type GuidanceFixtureSummary = {
  id: string;
  title: string;
  subject: string;
  driftProfile: DriftProfile;
  tags: string[];
  description?: string;
  gradeBand?: string;
};
export type MetricExpectation = z.infer<typeof metricExpectationSchema>;

export interface LoadFixtureOptions {
  rootDir?: string;
}

function resolveFixtureDirectory(customRoot?: string): string {
  if (customRoot) {
    return customRoot;
  }
  return DEFAULT_FIXTURE_DIRECTORY;
}

export function listGuidanceFixtures({ rootDir }: LoadFixtureOptions = {}): GuidanceFixtureSummary[] {
  const directory = resolveFixtureDirectory(rootDir);
  const files = fs.existsSync(directory)
    ? fs.readdirSync(directory, { withFileTypes: true })
    : [];

  return files
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => {
      const fixture = parseFixtureFromFile(path.join(directory, entry.name));
      return {
        id: fixture.metadata.id,
        title: fixture.metadata.title,
        subject: fixture.metadata.subject,
        driftProfile: fixture.metadata.driftProfile,
        tags: fixture.metadata.tags,
        description: fixture.metadata.description,
        gradeBand: fixture.metadata.gradeBand,
      } satisfies GuidanceFixtureSummary;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function loadGuidanceFixture(id: string, { rootDir }: LoadFixtureOptions = {}): GuidanceFixture {
  const directory = resolveFixtureDirectory(rootDir);
  const filePath = path.join(directory, `${id}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Fixture '${id}' not found at ${filePath}`);
  }
  return parseFixtureFromFile(filePath);
}

export function loadAllGuidanceFixtures({ rootDir }: LoadFixtureOptions = {}): GuidanceFixture[] {
  return listGuidanceFixtures({ rootDir }).map((summary) => loadGuidanceFixture(summary.id, { rootDir }));
}

export function parseFixtureFromFile(filePath: string): GuidanceFixture {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Fixture file does not exist: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Unable to parse JSON fixture at ${filePath}: ${(error as Error).message}`);
  }

  const fixture = fixtureSchema.parse(parsed);
  assertChronological(fixture.transcript, filePath);
  return fixture;
}

function assertChronological(lines: GuidanceTranscriptLine[], filePath: string): void {
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].timestamp < lines[index - 1].timestamp) {
      throw new Error(
        `Fixture ${path.basename(filePath)} has out-of-order timestamps at index ${index} (${lines[index].timestamp} < ${lines[index - 1].timestamp})`
      );
    }
  }
}

function normaliseSpeaker(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) {
    return label;
  }

  const [first, ...rest] = trimmed.split(' ');
  return [capitalise(first), ...rest.map(capitalise)].join(' ');
}

function capitalise(value: string): string {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

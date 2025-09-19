import { databricksMock, databricksMockService } from '../services/databricks.mock.service';

type Row = Record<string, any>;

export const seedDatabricksTable = (table: string, rows: Row[]): void => {
  databricksMock.seedTable(table, rows);
};

export const resetDatabricksMockState = (): void => {
  databricksMock.reset();
};

export const seedGuidanceMetrics = (rows: Row[] = []): void => {
  const defaultRows = rows.length > 0 ? rows : [
    {
      prompt_id: 'prompt-1',
      session_id: 'session-1',
      context_reason: 'Recent discussion drifted from the learning goal.',
      context_prior_topic: 'Photosynthesis steps',
      context_current_topic: 'Weekend plans',
      context_transition_idea: 'Bridge back by connecting energy transfer to the activity.',
      context_supporting_lines: [
        { speaker: 'Participant 1', quote: 'Remember the chlorophyll cycle?', timestamp: new Date().toISOString() },
      ],
      bridging_prompt: 'Acknowledge the tangent and reconnect to photosynthesis.',
      context_confidence: 0.8,
      on_track_summary: null,
    },
  ];

  seedDatabricksTable('classwaves.ai_insights.teacher_guidance_metrics', defaultRows);
};

export const seedSchemaMigrations = (rows: Row[] = []): void => {
  const entries = rows.length > 0 ? rows : [];
  seedDatabricksTable('classwaves.admin.schema_migrations', entries);
};

export const ensureDatabricksMockTables = async (): Promise<void> => {
  await databricksMockService.query(`CREATE TABLE IF NOT EXISTS classwaves.admin.schema_migrations (
    id STRING,
    migration_name STRING,
    migration_file STRING,
    sql_hash STRING,
    executed_at TIMESTAMP,
    execution_time_ms BIGINT,
    status STRING,
    error_message STRING
  ) USING DELTA`);

  await databricksMockService.query(`CREATE TABLE IF NOT EXISTS classwaves.ai_insights.teacher_guidance_metrics (
    prompt_id STRING,
    session_id STRING,
    context_reason STRING,
    context_prior_topic STRING,
    context_current_topic STRING,
    context_transition_idea STRING,
    context_supporting_lines ARRAY<STRUCT<speaker STRING, quote STRING, timestamp TIMESTAMP>>,
    bridging_prompt STRING,
    context_confidence DOUBLE,
    on_track_summary STRING
  ) USING DELTA`);
};

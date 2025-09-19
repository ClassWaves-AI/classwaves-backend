CREATE SCHEMA IF NOT EXISTS classwaves.admin;
CREATE TABLE IF NOT EXISTS classwaves.admin.schema_migrations (
  id STRING NOT NULL,
  migration_name STRING NOT NULL,
  migration_file STRING NOT NULL,
  sql_hash STRING NOT NULL,
  executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  execution_time_ms BIGINT,
  status STRING NOT NULL DEFAULT 'SUCCESS',
  error_message STRING
) USING DELTA;

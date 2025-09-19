import { execSync } from 'child_process';
import path from 'path';
import type { Application } from 'express';
import { FeatureFlags } from '@classwaves/shared';

const backendRoot = path.resolve(__dirname, '../../../..');
const DEFAULT_DATABASE_URL = 'postgres://classwaves:classwaves@localhost:5433/classwaves_dev';
const DB_LOCAL_USE_EXISTING = process.env.DB_LOCAL_USE_EXISTING === '1';

export const ENABLE_LOCAL_DB_TESTS = process.env.ENABLE_LOCAL_DB_TESTS === '1';

interface DbConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

function parseDatabaseUrl(): DbConnectionConfig {
  const rawUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const url = new URL(rawUrl);
  const password = url.password || process.env.PGPASSWORD || 'classwaves';
  return {
    host: url.hostname || 'localhost',
    port: url.port ? Number(url.port) : 5432,
    user: url.username || 'classwaves',
    password,
    database: url.pathname.replace(/^\//, '') || 'classwaves_dev',
  };
}

function runPsqlCommand(sql: string): void {
  const cfg = parseDatabaseUrl();
  const env = { ...process.env, PGPASSWORD: cfg.password };
  const command = `psql -v ON_ERROR_STOP=1 -h ${cfg.host} -p ${cfg.port} -U ${cfg.user} -d ${cfg.database} -c "${sql}"`;
  execSync(command, { stdio: 'inherit', env });
}

function runPsqlFile(file: string): void {
  const cfg = parseDatabaseUrl();
  const env = { ...process.env, PGPASSWORD: cfg.password };
  const command = `psql -v ON_ERROR_STOP=1 -h ${cfg.host} -p ${cfg.port} -U ${cfg.user} -d ${cfg.database} -f "${file}"`;
  execSync(command, { stdio: 'inherit', env });
}

function resetExistingDatabase(): void {
  runPsqlCommand('DROP SCHEMA IF EXISTS ai_insights CASCADE;');
  runPsqlCommand('DROP SCHEMA IF EXISTS analytics CASCADE;');
  runPsqlCommand('DROP SCHEMA IF EXISTS sessions CASCADE;');
  runPsqlCommand('DROP SCHEMA IF EXISTS users CASCADE;');
  runPsqlFile(path.join(backendRoot, 'src/db/local/schema.sql'));
  runPsqlFile(path.join(backendRoot, 'src/db/local/seeds/dev.sql'));
}

function initExistingDatabase(): void {
  runPsqlFile(path.join(backendRoot, 'src/db/local/schema.sql'));
  runPsqlFile(path.join(backendRoot, 'src/db/local/seeds/dev.sql'));
}

export function ensureLocalPostgresReset(): void {
  if (DB_LOCAL_USE_EXISTING) {
    resetExistingDatabase();
    return;
  }
  execSync('npm run db:local:reset', { cwd: backendRoot, stdio: 'inherit' });
}

export function ensureLocalPostgresInit(): void {
  if (DB_LOCAL_USE_EXISTING) {
    initExistingDatabase();
    return;
  }
  execSync('npm run db:local:init', { cwd: backendRoot, stdio: 'inherit' });
}

export function loadPostgresApp(): Application {
  jest.resetModules();
  process.env.NODE_ENV = 'test';
  process.env.DB_PROVIDER = 'postgres';
  process.env[FeatureFlags.DB_USE_LOCAL_POSTGRES] = '1';
  process.env.METRICS_DEFAULT_DISABLED = '1';
  process.env.OTEL_ENABLED = '0';
  // Ensure dotenv does not override during repeated loads
  delete process.env.DATABRICKS_HOST;
  delete process.env.DATABRICKS_TOKEN;
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require, import/no-dynamic-require
  return require('../../../app').default as Application;
}

export function maybeDescribe(name: string, fn: () => void): void {
  (ENABLE_LOCAL_DB_TESTS ? describe : describe.skip)(name, fn);
}

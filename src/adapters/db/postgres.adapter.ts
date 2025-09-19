import { Pool, PoolClient, PoolConfig } from 'pg';
import * as client from 'prom-client';
import { v4 as uuidv4 } from 'uuid';
import type { DbPort, DbQueryOptions, DbTransactionPort } from '../../services/ports/db.port';
import { normalizeTableFqn } from './fqn.utils';
import { logger } from '../../utils/logger';

const PROVIDER_LABEL = 'postgres';

function getLongQueryThresholdMs(): number {
  return Number(process.env.DB_LONG_QUERY_WARN_MS ?? 500);
}

function recordLongQuery(labels: MetricLabels, startTime: number, error?: unknown): void {
  const durationMs = Date.now() - startTime;
  const threshold = getLongQueryThresholdMs();
  if (durationMs >= threshold) {
    longRunningCounter.inc(labels);
    logger.warn('db-query-long-running', {
      provider: PROVIDER_LABEL,
      operation: labels.operation,
      durationMs,
      thresholdMs: threshold,
      ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
    });
  }
}

interface PostgresAdapterConfig {
  connectionString: string;
  poolMin: number;
  poolMax: number;
  ssl: boolean;
  logSql: boolean;
  connectionTimeoutMs: number;
}

interface MetricLabels {
  provider: string;
  operation: string;
}

const attemptsCounter = (() => {
  const name = 'classwaves_db_query_attempts_total';
  const existing = client.register.getSingleMetric(name) as client.Counter<string> | undefined;
  if (existing) return existing;
  return new client.Counter({
    name,
    help: 'Total database query attempts by provider and operation',
    labelNames: ['provider', 'operation'],
  });
})();

const failureCounter = (() => {
  const name = 'classwaves_db_query_failures_total';
  const existing = client.register.getSingleMetric(name) as client.Counter<string> | undefined;
  if (existing) return existing;
  return new client.Counter({
    name,
    help: 'Total database query failures grouped by provider and error code',
    labelNames: ['provider', 'code'],
  });
})();

const durationHistogram = (() => {
  const name = 'classwaves_db_query_duration_ms';
  const existing = client.register.getSingleMetric(name) as client.Histogram<string> | undefined;
  if (existing) return existing;
  return new client.Histogram({
    name,
    help: 'Database query duration in milliseconds',
    labelNames: ['provider', 'operation'],
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2000],
  });
})();

const longRunningCounter = (() => {
  const name = 'classwaves_db_query_long_running_total';
  const existing = client.register.getSingleMetric(name) as client.Counter<string> | undefined;
  if (existing) return existing;
  return new client.Counter({
    name,
    help: 'Total number of database queries exceeding the configured warning threshold',
    labelNames: ['provider', 'operation'],
  });
})();

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no') {
    return false;
  }
  return fallback;
}

function parseNumberEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildConfig(overrides: Partial<PostgresAdapterConfig> = {}): PostgresAdapterConfig {
  return {
    connectionString:
      overrides.connectionString ?? process.env.DATABASE_URL ?? 'postgres://classwaves:classwaves@localhost:5433/classwaves_dev',
    poolMin: overrides.poolMin ?? parseNumberEnv(process.env.DB_POOL_MIN, 1),
    poolMax: overrides.poolMax ?? parseNumberEnv(process.env.DB_POOL_MAX, 10),
    ssl: overrides.ssl ?? parseBooleanEnv(process.env.DB_SSL, false),
    logSql: overrides.logSql ?? parseBooleanEnv(process.env.DB_LOG_SQL, false),
    connectionTimeoutMs: overrides.connectionTimeoutMs ?? parseNumberEnv(process.env.DB_CONNECT_TIMEOUT_MS, 5000),
  };
}

export function rewriteQuestionMarkPlaceholders(sql: string): string {
  let result = '';
  let paramIndex = 1;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      result += char;
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        result += '*/';
        i += 1;
        continue;
      }
      result += char;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === '-' && next === '-') {
        inLineComment = true;
        result += '--';
        i += 1;
        continue;
      }
      if (char === '/' && next === '*') {
        inBlockComment = true;
        result += '/*';
        i += 1;
        continue;
      }
    }

    if (!inDoubleQuote && char === "'") {
      if (inSingleQuote && next === "'") {
        result += "''";
        i += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      result += char;
      continue;
    }

    if (!inSingleQuote && char === '"') {
      if (inDoubleQuote && next === '"') {
        result += '""';
        i += 1;
        continue;
      }
      inDoubleQuote = !inDoubleQuote;
      result += char;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === '?') {
      result += `$${paramIndex}`;
      paramIndex += 1;
    } else {
      result += char;
    }
  }
  return result;
}

function inferOperation(sql: string, fallback: string): string {
  const match = sql.trim().split(/\s+/)[0];
  if (!match) {
    return fallback;
  }
  return match.toLowerCase();
}

function preprocessParams(params: unknown[] = []): unknown[] {
  return params.map((value) => {
    if (value === undefined) {
      return null;
    }
    if (value === null) {
      return value;
    }
    if (value instanceof Date) {
      return value;
    }
    if (Buffer.isBuffer(value)) {
      return value;
    }
    if (Array.isArray(value)) {
      const containsOnlyPrimitives = value.every((item) =>
        item === null || ['string', 'number', 'boolean'].includes(typeof item)
      );
      return containsOnlyPrimitives ? value : JSON.stringify(value);
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return value;
  });
}

export class PostgresAdapterError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'PostgresAdapterError';
    this.code = code;
  }
}

function mapPgError(err: unknown): PostgresAdapterError {
  if (err instanceof PostgresAdapterError) {
    return err;
  }
  const code = typeof (err as any)?.code === 'string' ? (err as any).code : 'unknown';
  const message = err instanceof Error ? err.message : 'Unknown Postgres error';
  return new PostgresAdapterError(message, code);
}

interface ExecuteOptions {
  params?: unknown[];
  options?: DbQueryOptions;
  client?: PoolClient;
}

class ScopedTransactionAdapter implements DbTransactionPort {
  constructor(private readonly adapter: PostgresDbAdapter, private readonly client: PoolClient) {}

  query<T = unknown>(sql: string, params?: unknown[], options?: DbQueryOptions): Promise<T[]> {
    return this.adapter.runQuery<T>(sql, { params, options, client: this.client }).then((r) => r.rows);
  }

  async queryOne<T = unknown>(sql: string, params?: unknown[], options?: DbQueryOptions): Promise<T | null> {
    const result = await this.adapter.runQuery<T>(sql, { params, options, client: this.client });
    return result.rows[0] ?? null;
  }

  insert(tableFqn: string, row: Record<string, unknown>, options?: DbQueryOptions): Promise<void> {
    return this.adapter.insertInternal(tableFqn, row, options, this.client);
  }

  update(
    tableFqn: string,
    id: string,
    patch: Record<string, unknown>,
    idColumn?: string,
    options?: DbQueryOptions
  ): Promise<void> {
    return this.adapter.updateInternal(tableFqn, id, patch, idColumn, options, this.client);
  }

  upsert(
    tableFqn: string,
    keyColumns: string[],
    row: Record<string, unknown>,
    options?: DbQueryOptions
  ): Promise<void> {
    return this.adapter.upsertInternal(tableFqn, keyColumns, row, options, this.client);
  }

  tableHasColumns(schema: string, table: string, columns: string[]): Promise<boolean> {
    return this.adapter.tableHasColumnsInternal(schema, table, columns, this.client);
  }
}

export class PostgresDbAdapter implements DbPort {
  private readonly pool: Pool;

  private readonly logSql: boolean;

  constructor(private readonly config: PostgresAdapterConfig = buildConfig()) {
    const poolConfig: PoolConfig = {
      connectionString: config.connectionString,
      min: config.poolMin,
      max: config.poolMax,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: config.connectionTimeoutMs,
    };
    this.pool = new Pool(poolConfig);
    this.logSql = config.logSql;
  }

  async connect(): Promise<void> {
    try {
      const client = await this.pool.connect();
      client.release();
    } catch (error) {
      throw mapPgError(error);
    }
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
  }

  async withTransaction<T>(handler: (tx: DbTransactionPort) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const txAdapter = new ScopedTransactionAdapter(this, client);
      const result = await handler(txAdapter);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw mapPgError(error);
    } finally {
      client.release();
    }
  }

  async query<T = unknown>(sql: string, params?: unknown[], options?: DbQueryOptions): Promise<T[]> {
    const result = await this.runQuery<T>(sql, { params, options });
    return result.rows;
  }

  async queryOne<T = unknown>(sql: string, params?: unknown[], options?: DbQueryOptions): Promise<T | null> {
    const result = await this.runQuery<T>(sql, { params, options });
    return result.rows[0] ?? null;
  }

  async insert(tableFqn: string, row: Record<string, unknown>, options?: DbQueryOptions): Promise<void> {
    await this.insertInternal(tableFqn, row, options);
  }

  async update(
    tableFqn: string,
    id: string,
    patch: Record<string, unknown>,
    idColumn = 'id',
    options?: DbQueryOptions
  ): Promise<void> {
    await this.updateInternal(tableFqn, id, patch, idColumn, options);
  }

  async upsert(
    tableFqn: string,
    keyColumns: string[],
    row: Record<string, unknown>,
    options?: DbQueryOptions
  ): Promise<void> {
    await this.upsertInternal(tableFqn, keyColumns, row, options);
  }

  async tableHasColumns(schema: string, table: string, columns: string[]): Promise<boolean> {
    return this.tableHasColumnsInternal(schema, table, columns);
  }

  generateId(): string {
    return uuidv4();
  }

  private buildLabels(operation: string | undefined, sql: string): MetricLabels {
    const fallback = operation ?? inferOperation(sql, 'query');
    return { provider: PROVIDER_LABEL, operation: fallback };
  }

  async runQuery<T = unknown>(
    sql: string,
    { params = [], options, client }: ExecuteOptions
  ): Promise<{ rows: T[] }> {
    const values = preprocessParams(params);
    const rewritten = sql.includes('?') ? rewriteQuestionMarkPlaceholders(sql) : sql;
    const text = rewritten.replace(/classwaves\./g, '');
    const labels = this.buildLabels(options?.operation, sql);
    attemptsCounter.inc(labels);
    const stopTimer = durationHistogram.startTimer(labels);
    const startTime = Date.now();
    try {
      if (this.logSql) {
        logger.debug('[PostgresDbAdapter] SQL', { text, values });
      }
      const target = client ?? this.pool;
      const result = await target.query(text, values);
      stopTimer();
      recordLongQuery(labels, startTime);
      return { rows: result.rows as T[] };
    } catch (error) {
      stopTimer();
      const mapped = mapPgError(error);
      const failureLabels = { provider: PROVIDER_LABEL, code: mapped.code };
      failureCounter.inc(failureLabels);
      recordLongQuery(labels, startTime, mapped);
      throw mapped;
    }
  }

  async insertInternal(
    tableFqn: string,
    row: Record<string, unknown>,
    options?: DbQueryOptions,
    client?: PoolClient
  ): Promise<void> {
    const entries = Object.entries(row);
    if (entries.length === 0) {
      throw new Error('insert requires at least one column');
    }
    const { identifier } = normalizeTableFqn(tableFqn);
    const columns = entries.map(([column]) => column);
    const placeholders = entries.map((_, index) => '?').join(', ');
    const sql = `INSERT INTO ${identifier} (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`;
    const params = entries.map(([, value]) => value);
    await this.runQuery(sql, { params, options: { operation: options?.operation ?? 'insert' }, client });
  }

  async updateInternal(
    tableFqn: string,
    id: string,
    patch: Record<string, unknown>,
    idColumn = 'id',
    options?: DbQueryOptions,
    client?: PoolClient
  ): Promise<void> {
    const entries = Object.entries(patch);
    if (entries.length === 0) {
      return;
    }
    const { identifier } = normalizeTableFqn(tableFqn);
    const setClauses = entries.map(([column]) => `"${column}" = ?`).join(', ');
    const sql = `UPDATE ${identifier} SET ${setClauses} WHERE "${idColumn}" = ?`;
    const params = [...entries.map(([, value]) => value), id];
    await this.runQuery(sql, { params, options: { operation: options?.operation ?? 'update' }, client });
  }

  async upsertInternal(
    tableFqn: string,
    keyColumns: string[],
    row: Record<string, unknown>,
    options?: DbQueryOptions,
    client?: PoolClient
  ): Promise<void> {
    if (keyColumns.length === 0) {
      throw new Error('upsert requires at least one key column');
    }
    const entries = Object.entries(row);
    if (entries.length === 0) {
      throw new Error('upsert requires at least one column');
    }
    const { identifier } = normalizeTableFqn(tableFqn);
    const columns = entries.map(([column]) => column);
    const insertPlaceholders = entries.map(() => '?').join(', ');
    const updateAssignments = entries
      .filter(([column]) => !keyColumns.includes(column))
      .map(([column]) => `"${column}" = EXCLUDED."${column}"`)
      .join(', ');
    const sqlParts = [
      `INSERT INTO ${identifier} (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${insertPlaceholders})`,
      `ON CONFLICT (${keyColumns.map((c) => `"${c}"`).join(', ')})`,
    ];
    if (updateAssignments) {
      sqlParts.push(`DO UPDATE SET ${updateAssignments}`);
    } else {
      sqlParts.push('DO NOTHING');
    }
    const sql = sqlParts.join(' ');
    const params = entries.map(([, value]) => value);
    await this.runQuery(sql, { params, options: { operation: options?.operation ?? 'upsert' }, client });
  }

  async tableHasColumnsInternal(
    schema: string,
    table: string,
    columns: string[],
    client?: PoolClient
  ): Promise<boolean> {
    if (columns.length === 0) {
      return true;
    }
    const sql = `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ?
        AND table_name = ?
        AND column_name = ANY(?::text[])
    `;
    const params = [schema, table, columns];
    const result = await this.runQuery<{ column_name: string }>(sql, {
      params,
      options: { operation: 'tableHasColumns' },
      client,
    });
    const found = new Set(result.rows.map((row) => row.column_name));
    return columns.every((col) => found.has(col));
  }
}

export function createPostgresDbAdapter(config?: Partial<PostgresAdapterConfig>): PostgresDbAdapter {
  return new PostgresDbAdapter(buildConfig(config));
}

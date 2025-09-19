import * as client from 'prom-client';
import type { DbPort, DbQueryOptions, DbTransactionPort } from '../../services/ports/db.port';
import { databricksService } from '../../services/databricks.service';
import { databricksConfig } from '../../config/databricks.config';
import { normalizeTableFqn } from './fqn.utils';
import { logger } from '../../utils/logger';

const PROVIDER_LABEL = 'databricks';

function getLongQueryThresholdMs(): number {
  return Number(process.env.DB_LONG_QUERY_WARN_MS ?? 500);
}

function recordLongQuery(labels: { provider: string; operation: string }, startTime: number, error?: unknown): void {
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

class DatabricksAdapterError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'DatabricksAdapterError';
  }
}

function inferOperation(sql: string, fallback: string): string {
  const match = sql.trim().split(/\s+/)[0];
  return match ? match.toLowerCase() : fallback;
}

function mapError(err: unknown): DatabricksAdapterError {
  if (err instanceof DatabricksAdapterError) {
    return err;
  }
  const raw = err as any;
  const code = typeof raw?.code === 'string' ? raw.code : 'unknown';
  const message = err instanceof Error ? err.message : 'Unknown Databricks error';
  return new DatabricksAdapterError(message, code);
}

function transformSqlForDatabricks(sql: string): string {
  if (!sql.includes('classwaves.')) {
    return sql;
  }
  const catalogPrefix = `${databricksConfig.catalog}.`;
  return sql.replace(/classwaves\./g, catalogPrefix);
}

interface ExecuteOptions {
  params?: unknown[];
  options?: DbQueryOptions;
}

class DatabricksTransactionAdapter implements DbTransactionPort {
  constructor(private readonly adapter: DatabricksDbAdapter) {}

  query<T = unknown>(sql: string, params?: unknown[], options?: DbQueryOptions): Promise<T[]> {
    return this.adapter.query(sql, params, options);
  }

  queryOne<T = unknown>(sql: string, params?: unknown[], options?: DbQueryOptions): Promise<T | null> {
    return this.adapter.queryOne(sql, params, options);
  }

  insert(tableFqn: string, row: Record<string, unknown>, options?: DbQueryOptions): Promise<void> {
    return this.adapter.insert(tableFqn, row, options);
  }

  update(
    tableFqn: string,
    id: string,
    patch: Record<string, unknown>,
    idColumn?: string,
    options?: DbQueryOptions
  ): Promise<void> {
    return this.adapter.update(tableFqn, id, patch, idColumn, options);
  }

  upsert(
    tableFqn: string,
    keyColumns: string[],
    row: Record<string, unknown>,
    options?: DbQueryOptions
  ): Promise<void> {
    return this.adapter.upsert(tableFqn, keyColumns, row, options);
  }

  tableHasColumns(schema: string, table: string, columns: string[]): Promise<boolean> {
    return this.adapter.tableHasColumns(schema, table, columns);
  }
}

export class DatabricksDbAdapter implements DbPort {
  private buildLabels(operation: string | undefined, sql: string): { provider: string; operation: string } {
    const op = operation ?? inferOperation(sql, 'query');
    return { provider: PROVIDER_LABEL, operation: op };
  }

  async connect(): Promise<void> {
    await databricksService.connect();
  }

  async disconnect(): Promise<void> {
    await databricksService.disconnect();
  }

  async withTransaction<T>(handler: (tx: DbTransactionPort) => Promise<T>): Promise<T> {
    try {
      return await handler(new DatabricksTransactionAdapter(this));
    } catch (error) {
      throw mapError(error);
    }
  }

  async query<T = unknown>(sql: string, params?: unknown[], options?: DbQueryOptions): Promise<T[]> {
    const { rows } = await this.runQuery<T>(sql, { params, options });
    return rows;
  }

  async queryOne<T = unknown>(sql: string, params?: unknown[], options?: DbQueryOptions): Promise<T | null> {
    const labels = this.buildLabels(options?.operation, sql);
    attemptsCounter.inc(labels);
    const stopTimer = durationHistogram.startTimer(labels);
    const startTime = Date.now();
    try {
      const transformed = transformSqlForDatabricks(sql);
      const row = await databricksService.queryOne<T>(transformed, params ?? []);
      stopTimer();
      recordLongQuery(labels, startTime);
      return row ?? null;
    } catch (error) {
      stopTimer();
      const mapped = mapError(error);
      failureCounter.inc({ provider: PROVIDER_LABEL, code: mapped.code });
      recordLongQuery(labels, startTime, mapped);
      throw mapped;
    }
  }

  async insert(tableFqn: string, row: Record<string, unknown>, options?: DbQueryOptions): Promise<void> {
    const { schema, table } = normalizeTableFqn(tableFqn);
    const labels = this.buildLabels(options?.operation ?? 'insert', `insert ${schema}.${table}`);
    attemptsCounter.inc(labels);
    const stopTimer = durationHistogram.startTimer(labels);
    const startTime = Date.now();
    try {
      await databricksService.insert(`${schema}.${table}`, row);
      stopTimer();
      recordLongQuery(labels, startTime);
    } catch (error) {
      stopTimer();
      const mapped = mapError(error);
      failureCounter.inc({ provider: PROVIDER_LABEL, code: mapped.code });
      recordLongQuery(labels, startTime, mapped);
      throw mapped;
    }
  }

  async update(
    tableFqn: string,
    id: string,
    patch: Record<string, unknown>,
    idColumn = 'id',
    options?: DbQueryOptions
  ): Promise<void> {
    const { schema, table } = normalizeTableFqn(tableFqn);
    const labels = this.buildLabels(options?.operation ?? 'update', `update ${schema}.${table}`);
    attemptsCounter.inc(labels);
    const stopTimer = durationHistogram.startTimer(labels);
    const startTime = Date.now();
    try {
      if (idColumn !== 'id') {
        await databricksService.updateWhere(`${schema}.${table}`, { [idColumn]: id }, patch);
      } else {
        await databricksService.update(`${schema}.${table}`, id, patch);
      }
      stopTimer();
      recordLongQuery(labels, startTime);
    } catch (error) {
      stopTimer();
      const mapped = mapError(error);
      failureCounter.inc({ provider: PROVIDER_LABEL, code: mapped.code });
      recordLongQuery(labels, startTime, mapped);
      throw mapped;
    }
  }

  async upsert(
    tableFqn: string,
    keyColumns: string[],
    row: Record<string, unknown>,
    options?: DbQueryOptions
  ): Promise<void> {
    if (keyColumns.length === 0) {
      throw new DatabricksAdapterError('upsert requires at least one key column', 'INVALID_ARGUMENT');
    }
    const { schema, table } = normalizeTableFqn(tableFqn);
    const labels = this.buildLabels(options?.operation ?? 'upsert', `upsert ${schema}.${table}`);
    attemptsCounter.inc(labels);
    const stopTimer = durationHistogram.startTimer(labels);
    const startTime = Date.now();
    try {
      const where: Record<string, unknown> = {};
      for (const key of keyColumns) {
        if (!(key in row)) {
          throw new DatabricksAdapterError(`Missing key column '${key}' in upsert row`, 'INVALID_ARGUMENT');
        }
      where[key] = row[key];
      }
      await databricksService.upsert(`${schema}.${table}`, where, row);
      stopTimer();
      recordLongQuery(labels, startTime);
    } catch (error) {
      stopTimer();
      const mapped = mapError(error);
      failureCounter.inc({ provider: PROVIDER_LABEL, code: mapped.code });
      recordLongQuery(labels, startTime, mapped);
      throw mapped;
    }
  }

  async tableHasColumns(schema: string, table: string, columns: string[]): Promise<boolean> {
    const labels = this.buildLabels('tableHasColumns', `tableHasColumns ${schema}.${table}`);
    attemptsCounter.inc(labels);
    const stopTimer = durationHistogram.startTimer(labels);
    const startTime = Date.now();
    try {
      const result = await databricksService.tableHasColumns(schema, table, columns);
      stopTimer();
      recordLongQuery(labels, startTime);
      return result;
    } catch (error) {
      stopTimer();
      const mapped = mapError(error);
      failureCounter.inc({ provider: PROVIDER_LABEL, code: mapped.code });
      recordLongQuery(labels, startTime, mapped);
      throw mapped;
    }
  }

  generateId(): string {
    return databricksService.generateId();
  }

  private async runQuery<T = unknown>(
    sql: string,
    { params = [], options }: ExecuteOptions
  ): Promise<{ rows: T[] }> {
    const labels = this.buildLabels(options?.operation, sql);
    attemptsCounter.inc(labels);
    const stopTimer = durationHistogram.startTimer(labels);
    const startTime = Date.now();
    try {
      const transformed = transformSqlForDatabricks(sql);
      const rows = await databricksService.query<T>(transformed, params);
      stopTimer();
      recordLongQuery(labels, startTime);
      return { rows };
    } catch (error) {
      stopTimer();
      const mapped = mapError(error);
      failureCounter.inc({ provider: PROVIDER_LABEL, code: mapped.code });
      recordLongQuery(labels, startTime, mapped);
      throw mapped;
    }
  }
}

export function createDatabricksDbAdapter(): DatabricksDbAdapter {
  return new DatabricksDbAdapter();
}

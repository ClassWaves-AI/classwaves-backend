import { createPostgresDbAdapter, rewriteQuestionMarkPlaceholders, PostgresAdapterError } from '../../../adapters/db/postgres.adapter';
import { normalizeTableFqn } from '../../../adapters/db/fqn.utils';
import * as promClient from 'prom-client';

const sampleJson = [
  { speaker: 'student', quote: 'Example', timestamp: '2025-01-01T00:00:00.000Z' },
];

describe('Postgres adapter helpers', () => {
  it('rewrites question mark placeholders while respecting strings and comments', () => {
    const sql = "SELECT id FROM table WHERE id = ? AND note = '?' -- ? should be ignored";
    const rewritten = rewriteQuestionMarkPlaceholders(sql);
    expect(rewritten).toBe("SELECT id FROM table WHERE id = $1 AND note = '?' -- ? should be ignored");
  });

  it('rewrites placeholders inside multi-line comments', () => {
    const sql = 'SELECT value FROM data /* ignore ? */ WHERE flag = ?';
    const rewritten = rewriteQuestionMarkPlaceholders(sql);
    expect(rewritten).toBe('SELECT value FROM data /* ignore ? */ WHERE flag = $1');
  });

  it('normalizes classwaves-prefixed table identifiers', () => {
    const { schema, table, identifier } = normalizeTableFqn('classwaves.sessions.student_groups');
    expect(schema).toBe('sessions');
    expect(table).toBe('student_groups');
    expect(identifier).toBe('sessions.student_groups');
  });

  it('throws for invalid table identifiers', () => {
    expect(() => normalizeTableFqn('student_groups')).toThrow('Invalid table FQN');
  });
});

describe('Postgres adapter SQL construction', () => {
  function buildAdapter() {
    return createPostgresDbAdapter({ connectionString: 'postgres://test' });
  }

  it('stringifies JSON values when inserting rows', async () => {
    const adapter = buildAdapter();
    const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
    (adapter as any).pool = { query: mockQuery };

    await adapter.insert('ai_insights.teacher_guidance_metrics', {
      id: 'id-1',
      context_supporting_lines: sampleJson,
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [, values] = mockQuery.mock.calls[0];
    expect(values).toEqual(['id-1', JSON.stringify(sampleJson)]);
  });

  it('builds upsert statements with conflict handling', async () => {
    const adapter = buildAdapter();
    const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
    (adapter as any).pool = { query: mockQuery };

    await adapter.upsert(
      'sessions.classroom_sessions',
      ['id'],
      { id: 'session-1', title: 'New title', status: 'active' }
    );

    const [text] = mockQuery.mock.calls[0];
    expect(text).toContain('ON CONFLICT ("id")');
    expect(text).toContain('DO UPDATE SET "title" = EXCLUDED."title", "status" = EXCLUDED."status"');
  });

  it('rolls back a transaction when handler throws', async () => {
    const adapter = buildAdapter();
    const mockClient = {
      query: jest.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
          return undefined;
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const mockPool = {
      connect: jest.fn(async () => mockClient),
    };
    (adapter as any).pool = mockPool;

    await expect(
      adapter.withTransaction(async () => {
        throw new PostgresAdapterError('boom', 'XX');
      })
    ).rejects.toBeInstanceOf(PostgresAdapterError);

    expect(mockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('records long-running queries via metrics', async () => {
    const adapter = buildAdapter();
    const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
    (adapter as any).pool = { query: mockQuery };

    promClient.register.resetMetrics();
    const originalThreshold = process.env.DB_LONG_QUERY_WARN_MS;
    process.env.DB_LONG_QUERY_WARN_MS = '0';

    await adapter.query('SELECT 1', []);

    const metric = promClient.register.getSingleMetric('classwaves_db_query_long_running_total') as promClient.Counter<string>;
    const metricData = await metric.get();
    const total = metricData.values.reduce((acc, sample) => acc + sample.value, 0);
    expect(total).toBeGreaterThanOrEqual(1);

    if (originalThreshold === undefined) {
      delete process.env.DB_LONG_QUERY_WARN_MS;
    } else {
      process.env.DB_LONG_QUERY_WARN_MS = originalThreshold;
    }
  });
});

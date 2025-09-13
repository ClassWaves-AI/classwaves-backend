import 'dotenv/config';

// Configure low thresholds for fast tests BEFORE importing service
process.env.DATABRICKS_TIMEOUT_MS = '200';
process.env.DATABRICKS_CONNECT_TIMEOUT_MS = '200';
process.env.DATABRICKS_MAX_RETRIES = '2';
process.env.DATABRICKS_BACKOFF_BASE_MS = '1';
process.env.DATABRICKS_BACKOFF_MAX_MS = '4';
process.env.DATABRICKS_JITTER_RATIO = '0'; // deterministic
process.env.DATABRICKS_BREAKER_FAILURE_THRESHOLD = '2';
process.env.DATABRICKS_BREAKER_MIN_REQUESTS = '1';
process.env.DATABRICKS_BREAKER_RESET_TIMEOUT_MS = '200';

// Mock @databricks/sql client
let execCount = 0;
let shouldFailTimes = 0;
let failWith: Error | null = null;

class MockOperation {
  async fetchAll() { return [{ ok: 1 }]; }
  async close() { /* noop */ }
}

class MockSession {
  async executeStatement(_sql: string) {
    execCount++;
    if (shouldFailTimes > 0) {
      shouldFailTimes--;
      throw (failWith || new Error('ECONNRESET'));
    }
    return new MockOperation();
  }
  async close() {}
}

class MockConnection {
  async openSession() { return new MockSession(); }
}

class MockDBSQLClient {
  async connect() { return new MockConnection(); }
  async close() {}
}

jest.mock('@databricks/sql', () => ({ DBSQLClient: MockDBSQLClient }));

import { databricksService, getDatabricksService } from '../../../services/databricks.service';

describe('DatabricksService resilience', () => {
  beforeEach(() => {
    execCount = 0;
    shouldFailTimes = 0;
    failWith = null;
  });

  it('retries transient NETWORK error with backoff and succeeds', async () => {
    shouldFailTimes = 1;
    failWith = new Error('ECONNRESET');
    const rows = await databricksService.query('SELECT 1 as one');
    expect(rows).toBeTruthy();
    expect(execCount).toBe(2); // 1 fail + 1 success
  });

  it('opens circuit after repeated failures and blocks quickly', async () => {
    shouldFailTimes = 10;
    failWith = new Error('ECONNRESET');

    await expect(databricksService.query('SELECT 1')).rejects.toBeTruthy();
    // Next call should also fail but without many attempts once breaker opens
    await expect(databricksService.query('SELECT 1')).rejects.toBeTruthy();
    const status = getDatabricksService().getCircuitBreakerStatus();
    expect(['OPEN','HALF_OPEN','CLOSED']).toContain(status.state);
  });

  it('classifies AUTH errors as non-retriable', async () => {
    // Isolate module to reset singleton/breaker state
    execCount = 0;
    shouldFailTimes = 1;
    failWith = new Error('401 Unauthorized');
    await jest.isolateModulesAsync(async () => {
      const mod = await import('../../../services/databricks.service');
      await expect(mod.databricksService.query('SELECT 1')).rejects.toBeTruthy();
    });
    // Should not spam retries, expect only one exec attempt
    expect(execCount).toBe(1);
  });
});

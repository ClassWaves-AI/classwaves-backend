// Set test environment
process.env.NODE_ENV = 'test';
// Disable native lz4 to avoid arch/version issues in CI or Node 22
process.env.LZ4_DISABLE_NATIVE = process.env.LZ4_DISABLE_NATIVE || '1';
// Default: do not run network-bound tests unless explicitly enabled
process.env.ENABLE_NETWORK_TESTS = process.env.ENABLE_NETWORK_TESTS || '0';

// Load test-specific environment variables
import { config } from 'dotenv';
import {
  ensureDatabricksMockTables,
  resetDatabricksMockState,
  seedGuidanceMetrics,
  seedSchemaMigrations,
} from './databricks-mock.fixtures';
config({ path: '.env.test' });

// Extend Jest matchers
declare global {
  namespace jest {
    interface Matchers<R> {
      // Add custom matchers here if needed
    }
  }
}

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

// Reset mocks after each test
afterEach(() => {
  jest.clearAllMocks();
});

beforeEach(async () => {
  resetDatabricksMockState();
  await ensureDatabricksMockTables();
  seedSchemaMigrations();
  seedGuidanceMetrics();
});

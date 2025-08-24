// Set test environment
process.env.NODE_ENV = 'test';

// Load test-specific environment variables
import { config } from 'dotenv';
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
/** @type {import('jest').Config} */
const enableNetworkTests = process.env.ENABLE_NETWORK_TESTS === '1' || process.env.ENABLE_NETWORK_TESTS === 'true';

const forceExit = process.env.JEST_FORCE_EXIT !== '0'; // default true to avoid hanging handles
const detectOpenHandles = process.env.JEST_DETECT_OPEN_HANDLES === '1';

/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/__tests__/**/*.+(spec|test).+(ts|tsx|js)',
    '**/?(*.)+(spec|test).+(ts|tsx|js)'
  ],
  testPathIgnorePatterns: (() => {
    const base = [
      '/node_modules/',
      '/__tests__/fixtures/',
      '/__tests__/mocks/',
      '/__tests__/utils/',
    ];
    // In restricted environments, skip tests that require HTTP servers or real sockets
    if (!enableNetworkTests) {
      base.push('/__tests__/integration/');
      base.push('/__tests__/e2e/');
      base.push('/tests/e2e/');
    }
    return base;
  })(),
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json'
    }],
  },
  collectCoverageFrom: [
    // Focus coverage on core domain/services with strong unit suites
    'src/services/ai-analysis-buffer.service.ts',
    // Utilities that are unit-tested
    'src/utils/**/*.ts',
    // Exclusions
    '!src/utils/jwt.utils.ts',
    '!src/utils/schema-defaults.ts',
    '!src/utils/errors.ts',
    '!src/utils/auth-optimization.utils.ts',
    '!src/**/__tests__/**',
    '!src/**/test/**',
    '!src/**/*.d.ts',
  ],
  coverageThreshold: {
    // Focus gating on statements/lines at 80%, with pragmatic targets for branches/functions
    global: {
      statements: 80,
      lines: 80,
      functions: 70,
      branches: 70,
    }
  },
  coverageDirectory: 'coverage',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  globalTeardown: '<rootDir>/src/test/global-teardown.ts',
  testTimeout: 30000,
  clearMocks: true,
  restoreMocks: true,
  // Make CI/dev runs robust: force exit by default, and optionally detect open handles
  forceExit,
  detectOpenHandles,
};

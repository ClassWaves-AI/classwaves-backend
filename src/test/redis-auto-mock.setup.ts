/**
 * Jest auto-toggle for REDIS_USE_MOCK based on test path patterns.
 *
 * Runs before each test file is executed. If the test file path matches
 * one of the configured patterns, set process.env.REDIS_USE_MOCK = '1'
 * so the RedisService uses the in-memory mock client.
 *
 * You can override patterns via REDIS_USE_MOCK_PATTERNS (comma-separated substrings),
 * or disable auto-toggle for a run by explicitly setting REDIS_USE_MOCK.
 */

(() => {
  try {
    // Respect explicit user choice; do nothing if already set
    if (typeof process.env.REDIS_USE_MOCK === 'string') return;

    const state: any = (expect as any)?.getState?.() || {};
    const testPath: string = String(state.testPath || '');

    // Default patterns target heavy suites that don't need real Redis sockets
    const defaultPatterns = [
      '/__tests__/phase4/',
      'auth-security-validation.test',
      'auth-performance-load.test',
    ];
    const envPatterns = (process.env.REDIS_USE_MOCK_PATTERNS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const patterns = envPatterns.length > 0 ? envPatterns : defaultPatterns;

    const shouldMock = patterns.some((p) => testPath.includes(p));
    if (shouldMock) {
      process.env.REDIS_USE_MOCK = '1';
    }
  } catch {
    // ignore any issues in setup
  }
})();


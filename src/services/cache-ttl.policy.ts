/**
 * Central TTL policy and jitter helper for cache entries.
 * In tests, jitter is disabled for deterministic behavior.
 */

export const CacheTTLPolicy = {
  // Real-time analytics cache
  analyticsSession: 300,
  analyticsDashboard: 60,

  // Query cache strategies
  query: {
    'session-list': 900,
    'session-detail': 600,
    'teacher-analytics': 1800,
    'session-analytics': 1200,
  },

  // Edge/security-related TTLs
  csrf: 3600,
  secureSession: 86400,
  teacherSessionsSet: 86400,
  sessionAccessMapping: 86400,
} as const;

/**
 * Returns an effective TTL in seconds with +/- jitterPercent variation.
 * Example: base 300s with 15% -> range [255..345].
 * Disabled in NODE_ENV === 'test' for deterministic tests.
 */
export function ttlWithJitter(baseSeconds: number, jitterPercent = 0.15): number {
  if (process.env.NODE_ENV === 'test') return baseSeconds;
  if (!Number.isFinite(baseSeconds) || baseSeconds <= 1) return Math.max(1, Math.floor(baseSeconds));
  const range = Math.floor(baseSeconds * jitterPercent);
  if (range <= 0) return Math.floor(baseSeconds);
  const delta = Math.floor(Math.random() * (range * 2 + 1)) - range; // [-range, +range]
  return Math.max(1, Math.floor(baseSeconds + delta));
}


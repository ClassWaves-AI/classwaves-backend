# Redis Key Migration: cw:{env}:* Prefixes

This document outlines the dual-read/dual-write migration strategy to move Redis keys to a namespaced schema `cw:{NODE_ENV}:{...}` while avoiding downtime and regressions.

## Goals
- Prefix keys with `cw:{env}:...` to isolate environments and simplify operations.
- Avoid blocking `KEYS` on prod paths; prefer SCAN or versioned keys.
- Migrate incrementally using dual-read (and temporary dual-write) with clear rollback.

## Feature Flags
- `CW_CACHE_PREFIX_ENABLED=1` — enable prefixed keys and dual-read fallback to legacy.
- `CW_CACHE_DUAL_WRITE=1` — during migration, write to both prefixed and legacy keys.
- `CW_CACHE_EPOCHS_ENABLED=1` — enable tag epochs for O(1) invalidation (query cache).
- `CW_RL_PREFIX_ENABLED=1` — apply `cw:{env}:rl:*` prefixes for rate limiter.

## Migration Scope
- Completed
  - Query cache: `query_cache:{type}:{key}` → `cw:{env}:query_cache:{type}:{key}` (dual-read/write)
  - Real-time analytics: `analytics:session:{id}` → `cw:{env}:analytics:session:{id}` (dual-read/write)
  - Rate limiter: `rl:*` → `cw:{env}:rl:*` (via keyPrefix builder)
- Newly Migrated (this change)
  - Secure sessions: `secure_session:{id}` → `cw:{env}:secure_session:{id}` (dual-read/write)
  - Teacher sessions set: `teacher_sessions:{teacherId}` → `cw:{env}:teacher_sessions:{teacherId}` (dual-read/write)
  - Access codes: `session:{id}:access_code` and `access_code:{code}` → `cw:{env}:...` (dual-read/write)
  - CSRF: `csrf:{sessionId}` → `cw:{env}:csrf:{sessionId}` (dual-read/write)

## Rollout Plan
1) Enable `CW_CACHE_PREFIX_ENABLED=1` and `CW_CACHE_DUAL_WRITE=1` in the target environment.
2) Observe fallback metrics
   - Query cache: `legacyFallbacks` in `QueryCacheService.getCacheMetrics()`
   - Analytics: `legacyFallbacks` in `RealTimeAnalyticsCacheService`
3) After fallback rate is ~0 for a period, disable legacy reads for the migrated areas:
   - Set `CW_CACHE_DUAL_WRITE=0` (prefixed-only writes).
4) Finally (optional), clean up legacy keys via SCAN-driven maintenance jobs.

## Rollback Plan
- Re-enable dual-read path by setting `CW_CACHE_PREFIX_ENABLED=1` and `CW_CACHE_DUAL_WRITE=1`.
- For rate limiter, set `CW_RL_PREFIX_ENABLED=0` to revert to legacy `rl:*` prefixes.

## Verification
Run in `classwaves-backend`:

```bash
# Check code paths
rg -n "makeKey\(|isPrefixEnabled|isDualWriteEnabled" src | sed -n '1,200p'
rg -n "secure_session:|teacher_sessions:|access_code:|csrf:" src | sed -n '1,200p'

# Exercise dual-read via tests
npm run test:unit
npm run test:integration:cache
npm run test:integration:cache:ws

# Env toggles preview
rg -n "CW_CACHE_PREFIX_ENABLED|CW_CACHE_DUAL_WRITE|CW_RL_PREFIX_ENABLED|CW_CACHE_EPOCHS_ENABLED" -S src .env.example README.md
```

## Notes
- For set-like structures (e.g., `teacher_sessions:{teacherId}`) we mirror operations on both sets during migration; reads prefer prefixed with fallback to legacy.
- For sensitive data (secure sessions, CSRF), all cache operations are fail-soft. In case of cache failures, authentication middleware falls back to DB or denies as appropriate.

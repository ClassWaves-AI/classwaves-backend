# Cache Policy — Source of Truth (SOT)

This document describes the cache keyspaces, TTLs, and invalidation strategies used by the backend. It is generated from the canonical policy in `src/services/cache-ttl.policy.ts`.

- Machine-readable JSON: `docs/cache-policy.sot.json`
- Generator script: `npm run cache:policy:print` (prints) or `npm run cache:policy:save` (saves to docs)

## Keyspaces

- `query_cache:session-list:{teacherId}` — TTL: 900s
- `query_cache:session-detail:{sessionId}` — TTL: 600s
- `query_cache:teacher-analytics:{teacherId}` — TTL: 1800s
- `query_cache:session-analytics:{sessionId}` — TTL: 1200s
- `secure_session:{sessionId}` — TTL: 86400s
- `csrf:{token}` — TTL: 3600s

All keys also support prefixed variants when key prefixing is enabled: `cw:{env}:{key}`.

## Invalidation

- Session lifecycle changes (start/pause/end) invalidate `session-detail:*{sessionId}*` and related epoch-tagged variants.
- Analytics recomputations do not eagerly invalidate; background refresh updates caches.

## Metrics

- Exposed Prometheus counters by keyspace (`queryType`):
  - `query_cache_hits_total`
  - `query_cache_misses_total`
  - `query_cache_refresh_ahead_total`
  - `query_cache_coalesced_total`
  - `query_cache_stale_served_total`
  - `query_cache_legacy_fallbacks_total`


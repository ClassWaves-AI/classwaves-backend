# Observability and SLO Plan (Phase 6)

This document proposes service-level objectives (SLOs), key metrics, and dashboard sketches for ClassWaves backend.

## SLOs
- API availability: 99.9% monthly
- P50/P95 HTTP latency: P50 < 100ms, P95 < 500ms for core endpoints
- WebSocket connection stability: 99% session uptime during active classes
- Background worker error rate: < 1% per day

## Metrics
- HTTP
  - request_count by route, status, method
  - request_duration_seconds histogram (P50/P90/P95/P99)
  - error_count by status class
- WebSocket
  - connection_count, disconnections, reconnects
  - per-namespace join/leave events
  - message_emit_count and latency where applicable
- Cache/Redis
  - hit_ratio, operations/sec, error_count
- DB (Databricks)
  - query_duration_seconds histogram by repository/method
  - query_error_count
- AI/External
  - OpenAI Whisper health (boolean gauge)
  - Email queue backlog and delivery latency

## Tracing (OpenTelemetry)
- Root span on each HTTP request with attributes: http.method, route, status_code, x.trace_id
- Controller spans for: Sessions, Analytics
- Optional exporter via `OTEL_EXPORTER_OTLP_ENDPOINT`

## Dashboards (Grafana Sketch)
- API Overview: latency heatmap, error rates, top endpoints by RPS
- WS Health: connections over time, reconnection spikes, namespace breakdown
- Cache & DB: Redis hit ratio, DB query histograms, top slow queries
- AI & Emails: Whisper availability, email backlog and failures

## Alerting (Examples)
- High 5xx rate (>2% over 5m)
- P95 latency > 1s over 10m
- WebSocket disconnections spike (>3 std dev from baseline)
- Redis hit ratio < 0.8 over 15m
- DB query error rate > 2% over 10m


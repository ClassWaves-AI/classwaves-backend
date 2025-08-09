# OpenAI Whisper DPA/Vendor Policy Notes

This document summarizes how ClassWaves uses OpenAI Whisper for Speech-to-Text (STT) and the associated data protection posture for DPA/vendor review.

## Scope
- STT provider: OpenAI Whisper HTTP API (model: `whisper-1`)
- Integration: Server-side only (Express/Node backend)
- Clients never see the API key; all requests are made from the server

## Data Handling
- Audio ingestion: WebSocket to backend; buffered in memory only
- Zero-disk guarantee: Audio buffers are never written to disk; buffers are zeroed immediately after submission
- Transmitted data: Audio window bytes sent over TLS 1.2+ to `api.openai.com` via HTTPS
- Received data: JSON transcript text and metadata (optional timestamps/language)
- Storage: Only transcripts are stored (Databricks). No raw audio is persisted.

## Security & Compliance
- Transport: TLS 1.2+; certificate validation by Node TLS stack
- Secrets: `OPENAI_API_KEY` stored server-side (env); never exposed to clients
- Access control: JWT-authenticated sessions; role-based access (teacher/admin)
- Audit logging: Session access and data access events recorded in compliance audit logs
- Rate limiting: API and WS ingress limited; STT calls use Bottleneck concurrency limiting
- Circuit breaker: Pauses calls to Whisper on consecutive failures; windows are buffered/adapted

## Retention & Minimization
- Audio retention: None (0 seconds). No temp files, no object storage, no DB audio blob fields
- Transcript retention: Stored in Databricks per data retention policy; no sensitive student PII in transcripts beyond classroom discussion content
- Data minimization: Only the audio necessary for the current window is transmitted; no extra fields in requests

## Vendor Region & Subprocessors
- Endpoint: `https://api.openai.com/v1/audio/transcriptions`
- Region: Subject to OpenAI’s platform routing; no region lock guaranteed
- Subprocessors: As disclosed by OpenAI; assess per OpenAI’s DPA/subprocessor list

## Incident Response & Rollback
- Disable STT: Set `STT_PROVIDER=off` to pause submissions while keeping analysis on last committed text
- Credential rotation: Call `openAIWhisperService.setApiKey(newKey)` at runtime or redeploy with updated env
- Monitoring: Prometheus metrics (`whisper_latency_ms`, `whisper_status_count`, `whisper_retry_count`, `stt_window_bytes`) and app logs

## Privacy Statements
- FERPA/COPPA: Audio is never stored; transcripts avoid PII beyond classroom content; audit trail maintained
- Student privacy: Group-only architecture avoids per-student voice identification

## Configuration Checklist
- [x] Server-only `OPENAI_API_KEY`
- [x] `STT_PROVIDER=openai` (or `off`)
- [x] `OPENAI_WHISPER_TIMEOUT_MS`, `OPENAI_WHISPER_CONCURRENCY`, `STT_WINDOW_SECONDS`, optional `STT_WINDOW_JITTER_MS`
- [x] Zero-disk path verified (buffers zeroed after submit)



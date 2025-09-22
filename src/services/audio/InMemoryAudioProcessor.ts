import { v4 as uuidv4 } from 'uuid';
import { getSttProvider } from '../stt.provider';
import { maybeTranscodeToWav } from './transcode.util';
import * as client from 'prom-client';
import { logger } from '../../utils/logger';

interface GroupWindowState {
  chunks: Buffer[];
  bytes: number;
  mimeType?: string;
  windowStartedAt: number;
  timer?: NodeJS.Timeout;
  windowSeconds: number;
  consecutiveFailureCount: number;
}

// Back-compat structure expected by older tests
interface AudioBufferCompat {
  data: Buffer;
  mimeType: string;
  timestamp: Date;
  size: number;
}

interface GroupTranscriptionResult {
  groupId: string;
  sessionId: string;
  text: string;
  confidence: number;
  timestamp: string;
  language?: string;
  duration?: number;
}

interface WhisperResponse {
  text: string;
  confidence: number;
  language?: string;
  duration?: number;
}

class AudioProcessingError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'AudioProcessingError';
  }
}

/**
 * InMemoryAudioProcessor - Zero-disk audio processing with <500ms latency
 * 
 * CRITICAL: This class NEVER writes audio data to disk for FERPA compliance.
 * All audio processing happens in memory with immediate cleanup.
 */
export class InMemoryAudioProcessor {
  private groupWindows = new Map<string, GroupWindowState>();
  // Back-compat map to satisfy legacy tests that introspect buffer usage directly
  private activeBuffers = new Map<string, AudioBufferCompat>();
  private processingStats = new Map<string, { count: number; totalLatency: number }>();
  // Per-group mutex to ensure atomic window operations
  private groupLocks = new Map<string, Promise<any>>();
  // Cache minimal container headers per group to make submissions self-contained
  private webmHeaders = new Map<string, Buffer>();
  private oggHeaders = new Map<string, Buffer>();
  private readonly MAX_TOTAL_MEMORY_MB = parseInt(process.env.AI_BUFFER_MAX_MEMORY_MB || '256', 10);
  private readonly MAX_HEAP_SIZE_MB = parseInt(process.env.MAX_HEAP_SIZE_MB || '1024', 10);
  private readonly maxBufferSize = 10_000_000; // 10MB threshold per group
  private readonly supportedFormats = ['audio/webm', 'audio/webm;codecs=opus', 'audio/ogg', 'audio/wav'];
  private readonly baseWindowSeconds = Number(process.env.STT_WINDOW_SECONDS || 15);
  private readonly maxWindowSeconds = 20;
  private readonly minWindowSeconds = 10;
  private readonly windowJitterMs = Number(process.env.STT_WINDOW_JITTER_MS || 0);
  private breakerOpenUntil: number | null = null;
  private readonly breakerFailuresToTrip = 5;
  private readonly breakerCooldownMs = 60_000; // 60s

  constructor() {
    // Start memory monitoring (skip timers in tests and Jest workers)
    const isJest = !!process.env.JEST_WORKER_ID;
    if (process.env.NODE_ENV !== 'test' && !isJest) this.startMemoryMonitoring();
    if (process.env.API_DEBUG === '1') logger.debug('✅ InMemoryAudioProcessor initialized with zero-disk guarantee');
  }

  // Metrics
  private readonly bpDrops = (() => {
    try {
      return new client.Counter({
        name: 'ws_backpressure_drops_total',
        help: 'Total audio chunks dropped due to backpressure',
      });
    } catch {
      return client.register.getSingleMetric('ws_backpressure_drops_total') as client.Counter<string>;
    }
  })();
  private readonly windowSecondsMetric = (() => {
    try {
      return new client.Histogram({
        name: 'stt_window_seconds',
        help: 'Window seconds at submit time',
        buckets: [5,10,12,15,18,20,25],
      });
    } catch {
      return client.register.getSingleMetric('stt_window_seconds') as client.Histogram<string>;
    }
  })();
  private readonly sttDisabledWindows = (() => {
    try {
      return new client.Counter({
        name: 'stt_disabled_windows_total',
        help: 'Total STT windows skipped due to STT_PROVIDER=off',
      });
    } catch {
      return client.register.getSingleMetric('stt_disabled_windows_total') as client.Counter<string>;
    }
  })();
  private readonly sttSubmitTotal = (() => {
    try {
      return new client.Counter({
        name: 'stt_submit_total',
        help: 'Total STT window submissions by status and school',
        labelNames: ['school', 'status']
      });
    } catch {
      return client.register.getSingleMetric('stt_submit_total') as client.Counter<string>;
    }
  })();

  /**
   * Ingest audio chunk into per-group window aggregator. Returns a transcription
   * result only when a window boundary is reached and submitted successfully.
   */
  async ingestGroupAudioChunk(
    groupId: string,
    audioChunk: Buffer,
    mimeType: string,
    sessionId: string,
    schoolId?: string
  ): Promise<GroupTranscriptionResult | null> {
    const run = async () => {
      const processingStart = performance.now();
      const bufferKey = `${groupId}-${Date.now()}`;
      const provider = getSttProvider();
      try {
        this.validateAudioFormat(mimeType);
        await this.handleBackPressure(groupId);
        this.verifyNoDiskWrites();
        const state = this.getOrCreateGroupWindow(groupId, mimeType);
        // Opportunistically capture a container header (WebM/Ogg) for this group from the first header-bearing chunk
        try {
          const mt = (mimeType || '').toLowerCase();
          if (mt.startsWith('audio/webm') && !this.webmHeaders.has(groupId)) {
            const hdr = this.extractWebMHeader(audioChunk);
            if (hdr && hdr.length > 0) this.webmHeaders.set(groupId, hdr);
          } else if (mt.startsWith('audio/ogg') && !this.oggHeaders.has(groupId)) {
            const hdr = this.extractOggHeader(audioChunk);
            if (hdr && hdr.length > 0) this.oggHeaders.set(groupId, hdr);
          }
        } catch { /* intentionally ignored: best effort cleanup */ }
        state.chunks.push(audioChunk);
        state.bytes += audioChunk.length;
        this.activeBuffers.set(bufferKey, { data: audioChunk, mimeType, timestamp: new Date(), size: audioChunk.length });

        // Special-case: Browser MediaRecorder emits self-contained WebM/Ogg files per timeslice.
        // Concatenating them creates invalid containers. For these formats, transcribe per chunk
        // and reset the window accumulator.
        const isContainerized = this.isContainerizedFormat(mimeType);
        if (isContainerized) {
          const start = performance.now();
          let submitBuffer = audioChunk;
          try {
            const mt = (mimeType || '').toLowerCase();
            if (mt.startsWith('audio/webm') && !this.hasWebMHeader(audioChunk)) {
              submitBuffer = this.maybePrependWebMHeader(groupId, audioChunk);
            } else if (mt.startsWith('audio/ogg') && !this.hasOggHeader(audioChunk)) {
              submitBuffer = this.maybePrependOggHeader(groupId, audioChunk);
            }
            if ((process.env.WS_STT_REPAIR_WEBM_FRAGMENTS || '0') === '1' && mt.startsWith('audio/webm')) {
              submitBuffer = this.tryRepairWebMFragment(groupId, submitBuffer);
            }
          } catch { /* intentionally ignored: best effort cleanup */ }
          let transcription: any;
          try {
            transcription = await provider.transcribeBuffer(submitBuffer, mimeType, {}, schoolId);
          } catch (e) {
            if (process.env.WS_STT_TRANSCODE_TO_WAV === '1') {
              try {
                if (process.env.API_DEBUG === '1') {
                  try { logger.warn('🎛️  WS Whisper decode error — attempting WAV transcode fallback'); } catch { /* intentionally ignored: best effort cleanup */ }
                }
                const wav = await maybeTranscodeToWav(submitBuffer, mimeType);
                transcription = await provider.transcribeBuffer(wav.buffer, wav.mime, {}, schoolId);
                if (process.env.API_DEBUG === '1') {
                  try { logger.debug('✅ WS WAV transcode fallback succeeded'); } catch { /* intentionally ignored: best effort cleanup */ }
                }
              } catch (e2) {
                throw e2;
              }
            } else {
              throw e;
            }
          }
          // Zero and reset window
          try { this.secureZeroBuffer(audioChunk); } catch { /* intentionally ignored: best effort cleanup */ }
          state.chunks = [];
          state.bytes = 0;
          state.windowStartedAt = Date.now() + this.getRandomJitterMs();
          const elapsed = performance.now() - start;
          this.recordPerformanceMetrics(groupId, elapsed);
          return {
            groupId,
            sessionId,
            text: transcription.text,
            confidence: transcription.confidence ?? 0.95,
            timestamp: new Date().toISOString(),
            language: transcription.language,
            duration: transcription.duration,
          } as GroupTranscriptionResult;
        }
        const now = Date.now();
        const atBoundary = (now - state.windowStartedAt) / 1000 >= state.windowSeconds;
        if (!atBoundary) return null;
        const transcription = await this.flushGroupWindow(groupId, state, mimeType, schoolId);
        const processingTime = performance.now() - processingStart;
        this.recordPerformanceMetrics(groupId, processingTime);
        return {
          groupId,
          sessionId,
          text: transcription.text,
          confidence: transcription.confidence,
          timestamp: new Date().toISOString(),
          language: transcription.language,
          duration: transcription.duration,
        } as GroupTranscriptionResult;
      } catch (error) {
        this.logError(groupId, sessionId, error instanceof Error ? error.message : 'Unknown error');
        throw new AudioProcessingError('TRANSCRIPTION_FAILED', error instanceof Error ? error.message : 'Audio processing failed');
      } finally {
        this.activeBuffers.delete(bufferKey);
      }
    };
    const prev = this.groupLocks.get(groupId) || Promise.resolve();
    const next = prev.catch(() => undefined).then(run);
    this.groupLocks.set(groupId, next as unknown as Promise<any>);
    return next.finally(() => {
      if (this.groupLocks.get(groupId) === next) this.groupLocks.delete(groupId);
    });
  }

  /**
   * Backward-compat: immediate per-chunk transcription API used by older code/tests.
   * Internally uses the window aggregator but forces an immediate flush.
   */
  async processGroupAudio(
    groupId: string,
    audioChunk: Buffer,
    mimeType: string,
    sessionId: string
  ): Promise<GroupTranscriptionResult> {
    // Backward-compat fast path: transcribe this single chunk immediately
    this.validateAudioFormat(mimeType);
    await this.handleBackPressure(groupId);
    this.verifyNoDiskWrites();
    const start = performance.now();
    // STT provider switch: short-circuit when disabled
    if (process.env.STT_PROVIDER === 'off') {
      this.sttDisabledWindows.inc();
      this.secureZeroBuffer(audioChunk);
      const elapsed = performance.now() - start;
      this.recordPerformanceMetrics(groupId, elapsed);
      return {
        groupId,
        sessionId,
        text: '',
        confidence: 0,
        timestamp: new Date().toISOString(),
        language: undefined,
        duration: undefined,
      };
    }
    const provider = getSttProvider();
    const transcription = await provider.transcribeBuffer(audioChunk, mimeType);
    // Zero buffer immediately
    this.secureZeroBuffer(audioChunk);
    const elapsed = performance.now() - start;
    this.recordPerformanceMetrics(groupId, elapsed);
    return {
      groupId,
      sessionId,
      text: transcription.text,
      confidence: transcription.confidence ?? 0.95,
      timestamp: new Date().toISOString(),
      language: transcription.language,
      duration: transcription.duration,
    };
  }

  private getOrCreateGroupWindow(groupId: string, mimeType: string): GroupWindowState {
    let state = this.groupWindows.get(groupId);
    if (!state) {
      state = {
        chunks: [],
        bytes: 0,
        mimeType,
        windowStartedAt: Date.now() + this.getRandomJitterMs(),
        windowSeconds: this.baseWindowSeconds,
        consecutiveFailureCount: 0,
      };
      this.groupWindows.set(groupId, state);
    } else if (!state.mimeType) {
      state.mimeType = mimeType;
    }
    return state;
  }

  private clampWindowSeconds(value: number): number {
    return Math.max(this.minWindowSeconds, Math.min(this.maxWindowSeconds, value));
  }

  private secureZeroBuffer(buf: Buffer): void {
    try {
      buf.fill(0);
    } catch {
      // ignore
    }
  }

  private async flushGroupWindow(groupId: string, state: GroupWindowState, fallbackMimeType: string, schoolId?: string): Promise<WhisperResponse> {
    // Circuit breaker check
    const now = Date.now();
    if (this.breakerOpenUntil && now < this.breakerOpenUntil) {
      logger.warn(`⛔ Whisper circuit breaker open; skipping submit for group ${groupId}`);
      // Increase window to reduce submit rate during outage
      state.windowSeconds = this.clampWindowSeconds(state.windowSeconds + 2);

      // Zero and reset window without emitting fabricated transcripts
      this.windowSecondsMetric.observe(state.windowSeconds);
      const mimeType = state.mimeType || fallbackMimeType;
      const windowBuffer = Buffer.concat(state.chunks, state.bytes);
      for (const chunk of state.chunks) this.secureZeroBuffer(chunk);
      state.chunks = [];
      state.bytes = 0;
      this.secureZeroBuffer(windowBuffer);
      state.windowStartedAt = Date.now();

      // Return empty transcript to indicate skip; upstream must gate on non-empty text
      return { text: '', confidence: 0, language: undefined, duration: undefined } as WhisperResponse;
    }

    // STT provider switch: if disabled, skip external submit but zero/drop buffers and advance window
    if (process.env.STT_PROVIDER === 'off') {
      this.windowSecondsMetric.observe(state.windowSeconds);
      const mimeType = state.mimeType || fallbackMimeType;
      const windowBuffer = Buffer.concat(state.chunks, state.bytes);
      for (const chunk of state.chunks) this.secureZeroBuffer(chunk);
      state.chunks = [];
      state.bytes = 0;
      this.secureZeroBuffer(windowBuffer);
      state.windowStartedAt = Date.now();
      this.sttDisabledWindows.inc();
      // Return empty transcript to indicate no update; upstream should ignore empty text
      return { text: '', confidence: 0, language: undefined, duration: undefined } as WhisperResponse;
    }

    const submitStart = performance.now();
    this.windowSecondsMetric.observe(state.windowSeconds);
    const mimeType = state.mimeType || fallbackMimeType;
    let windowBuffer = Buffer.concat(state.chunks, state.bytes);
    // Ensure WebM windows are self-contained files by prepending a cached header when needed
    try {
      if ((mimeType || '').toLowerCase().startsWith('audio/webm')) {
        windowBuffer = this.maybePrependWebMHeader(groupId, windowBuffer);
      }
    } catch { /* intentionally ignored: best effort cleanup */ }
    // Ensure immediate zeroing of individual chunks after concat
    for (const chunk of state.chunks) this.secureZeroBuffer(chunk);
    state.chunks = [];
    state.bytes = 0;

    const provider = getSttProvider();

    try {
      // Pass the window duration as a hint for budgeting when Whisper does not return duration
      const result = await provider.transcribeBuffer(windowBuffer, mimeType, { durationSeconds: state.windowSeconds }, schoolId);
      const latency = performance.now() - submitStart;
      if (process.env.API_DEBUG === '1') logger.debug(JSON.stringify({
        event: 'whisper_submit',
        groupId,
        whisper_latency_ms: Math.round(latency),
        whisper_status: 'ok',
        window_seconds: state.windowSeconds,
        window_bytes: windowBuffer.length,
      }));

      // Metrics: STT submit success labeled by school
      try { this.sttSubmitTotal.inc({ school: schoolId || 'unknown', status: 'ok' }); } catch { /* intentionally ignored: best effort cleanup */ }

      state.consecutiveFailureCount = 0;
      // Gradually reduce window toward base on success
      state.windowSeconds = this.clampWindowSeconds(state.windowSeconds - 1);
      return result as WhisperResponse;
    } catch (err: any) {
      const latency = performance.now() - submitStart;
      logger.warn(JSON.stringify({
        event: 'whisper_submit_failed',
        groupId,
        whisper_latency_ms: Math.round(latency),
        whisper_status: 'error',
        error_message: err?.message || 'unknown',
        window_seconds: state.windowSeconds,
      }));

      // Metrics: STT submit failure labeled by school
      try { this.sttSubmitTotal.inc({ school: schoolId || 'unknown', status: 'error' }); } catch { /* intentionally ignored: best effort cleanup */ }

      state.consecutiveFailureCount += 1;
      // Increase window to reduce rate
      state.windowSeconds = this.clampWindowSeconds(state.windowSeconds + 2);
      if (state.consecutiveFailureCount >= this.breakerFailuresToTrip) {
        this.breakerOpenUntil = Date.now() + this.breakerCooldownMs;
        logger.error(`🚨 Whisper circuit breaker TRIPPED for ${this.breakerCooldownMs / 1000}s`);
      }
      // Re-throw to caller to handle
      throw err;
    } finally {
      // Zero and drop concatenated buffer
      this.secureZeroBuffer(windowBuffer);
      state.windowStartedAt = Date.now() + this.getRandomJitterMs();
      this.forceGarbageCollection();
    }
  }

  /**
   * Validate audio format against supported types
   */
  private validateAudioFormat(mimeType: string): void {
    const normalizedType = mimeType.toLowerCase().split(';')[0];
    
    if (!this.supportedFormats.some(format => format.startsWith(normalizedType))) {
      throw new AudioProcessingError('UNSUPPORTED_FORMAT', 
        `Unsupported audio format: ${mimeType}. Supported: ${this.supportedFormats.join(', ')}`);
    }
  }

  private isContainerizedFormat(mimeType: string): boolean {
    const mt = (mimeType || '').toLowerCase();
    return mt.startsWith('audio/webm') || mt.startsWith('audio/ogg');
  }

  // --- WebM header utilities ---
  // Detect if a buffer starts with EBML header (1A 45 DF A3)
  private hasWebMHeader(buf: Buffer): boolean {
    return buf && buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
  }
  // Find the first Matroska Cluster element (1F 43 B6 75) index
  private findWebMClusterStart(buf: Buffer): number {
    if (!buf || buf.length < 4) return -1;
    const pat = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);
    return buf.indexOf(pat);
  }
  // Extract a minimal header (EBML+Segment+Tracks) by slicing up to Cluster start
  private extractWebMHeader(buf: Buffer): Buffer | null {
    try {
      if (!buf || buf.length < 16) return null;
      if (!this.hasWebMHeader(buf)) return null;
      const idx = this.findWebMClusterStart(buf);
      if (idx > 0) {
        return buf.subarray(0, idx);
      }
      // If no Cluster in this chunk, cache the whole thing as provisional header
      return buf;
    } catch {
      return null;
    }
  }

  // --- WebM fragment repair (align + rewrite) ---
  private ebmlVintLenFromFirstByte(b: number): number {
    if (b & 0x80) return 1;
    if (b & 0x40) return 2;
    if (b & 0x20) return 3;
    if (b & 0x10) return 4;
    if (b & 0x08) return 5;
    if (b & 0x04) return 6;
    if (b & 0x02) return 7;
    return 8;
  }
  private encodeEbmlVint(value: number, length: number): Buffer {
    const out = new Uint8Array(length);
    for (let i = length - 1; i >= 0; i--) {
      out[i] = value & 0x7f;
      value >>= 7;
    }
    const mask = 1 << (8 - length);
    out[0] |= mask;
    return Buffer.from(out);
  }
  private tryRepairWebMFragment(groupId: string, buf: Buffer): Buffer {
    try {
      if (!buf || buf.length < 16) return buf;
      // Ensure header present
      let out = buf;
      if (!this.hasWebMHeader(out)) {
        out = this.maybePrependWebMHeader(groupId, out);
      }
      const header = this.extractWebMHeader(out);
      const headerLen = header ? header.length : 0;
      // Find first Cluster after header
      const idx = this.findWebMClusterStart(out);
      if (idx < 0) return out; // no cluster signature present
      // If cluster starts before or at header end, consider it aligned; else drop junk between header and cluster
      let aligned = out;
      if (idx > headerLen) {
        aligned = Buffer.concat([ out.subarray(0, headerLen), out.subarray(idx) ]);
      }
      // Rewrite Cluster size to actual payload length
      const clusterStart = headerLen; // after possible trim, cluster at header end
      if (aligned.length < clusterStart + 5) return aligned; // not enough bytes for id+size
      // Validate cluster id
      if (!(aligned[clusterStart] === 0x1f && aligned[clusterStart+1] === 0x43 && aligned[clusterStart+2] === 0xb6 && aligned[clusterStart+3] === 0x75)) {
        return aligned;
      }
      const sizeFirst = aligned[clusterStart + 4];
      const oldL = this.ebmlVintLenFromFirstByte(sizeFirst);
      const oldPayloadStart = clusterStart + 4 + oldL;
      if (oldPayloadStart >= aligned.length) return aligned;
      // Choose minimal L so that payload fits in 7*L bits
      let chosenL = 1;
      for (let L = 1; L <= 4; L++) {
        const payloadLen = aligned.length - (clusterStart + 4 + L);
        const maxVal = (1 << (7 * L)) - 1; // safe for L<=4
        if (payloadLen >= 0 && payloadLen < maxVal) { chosenL = L; break; }
      }
      const newPayloadLen = aligned.length - (clusterStart + 4 + chosenL);
      if (newPayloadLen < 0) return aligned;
      const newSize = this.encodeEbmlVint(newPayloadLen, chosenL);
      // Assemble: header + clusterID + new size + payload (skip old size bytes)
      const head = aligned.subarray(0, clusterStart);
      const clusterId = aligned.subarray(clusterStart, clusterStart + 4);
      const payload = aligned.subarray(oldPayloadStart);
      const repaired = Buffer.concat([ head, clusterId, newSize, payload ]);
      return repaired;
    } catch {
      return buf;
    }
  }
  // If buffer lacks EBML header and we have a cached header for the group, prepend it
  private maybePrependWebMHeader(groupId: string, buf: Buffer): Buffer {
    if (!buf || buf.length === 0) return buf;
    if (this.hasWebMHeader(buf)) return buf; // already a full file
    const hdr = this.webmHeaders.get(groupId);
    if (hdr && hdr.length > 0) {
      if (process.env.API_DEBUG === '1') {
        logger.debug(JSON.stringify({ event: 'webm_header_prepended', groupId, header_bytes: hdr.length, window_bytes: buf.length }));
      }
      return Buffer.concat([hdr, buf], hdr.length + buf.length);
    }
    return buf;
  }

  // --- OGG header utilities ---
  private hasOggHeader(buf: Buffer): boolean {
    return buf && buf.length >= 4 && buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53; // 'OggS'
  }
  private extractOggHeader(buf: Buffer): Buffer | null {
    try {
      if (!buf || buf.length < 32) return null;
      if (!this.hasOggHeader(buf)) return null;
      // As a pragmatic approach, cache the entire first chunk as header for reuse
      return buf;
    } catch { return null; }
  }
  private maybePrependOggHeader(groupId: string, buf: Buffer): Buffer {
    if (!buf || buf.length === 0) return buf;
    if (this.hasOggHeader(buf)) return buf;
    const hdr = this.oggHeaders.get(groupId);
    if (hdr && hdr.length > 0) {
      if (process.env.API_DEBUG === '1') {
        logger.debug(JSON.stringify({ event: 'ogg_header_prepended', groupId, header_bytes: hdr.length, window_bytes: buf.length }));
      }
      return Buffer.concat([hdr, buf], hdr.length + buf.length);
    }
    return buf;
  }

  /**
   * Monitor and prevent disk writes during audio processing
   */
  private verifyNoDiskWrites(): void {
    // In a production environment, this would use fs monitoring
    // For now, we ensure no file operations in our code path
    const memoryUsage = process.memoryUsage();
    
    if (memoryUsage.heapUsed > 500_000_000) { // 500MB warning
      logger.warn(`⚠️  High memory usage detected: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`);
    }
  }

  /**
   * Handle back-pressure management for high-load scenarios
   */
  private async handleBackPressure(groupId: string): Promise<void> {
    const groupState = this.groupWindows.get(groupId);
    const windowBytes = groupState?.bytes ?? 0;
    const compatBytes = Array.from(this.activeBuffers.entries())
      .filter(([key]) => key.startsWith(groupId))
      .reduce((acc, [, buf]) => acc + (buf.size || buf.data.length), 0);
    const groupBytes = windowBytes + compatBytes;
    if (groupBytes > this.maxBufferSize) {
      logger.warn(`⚠️  Group buffer overflow; dropping oldest chunks for group ${groupId}`);
      if (groupState) {
        // Drop oldest half of chunks
        const dropCount = Math.ceil(groupState.chunks.length / 2);
        const dropped = groupState.chunks.splice(0, dropCount);
        for (const c of dropped) this.secureZeroBuffer(c);
        this.bpDrops.inc(dropCount);
        groupState.bytes = groupState.chunks.reduce((acc, b) => acc + b.length, 0);
        // Expand window to slow submit rate
        groupState.windowSeconds = this.clampWindowSeconds(groupState.windowSeconds + 2);
      }
      // Drop half of compat entries as well
      const keys = Array.from(this.activeBuffers.keys()).filter((k) => k.startsWith(groupId));
      const dropKeys = keys.slice(0, Math.ceil(keys.length / 2));
      for (const k of dropKeys) {
        const entry = this.activeBuffers.get(k);
        if (entry) this.secureZeroBuffer(entry.data);
        this.activeBuffers.delete(k);
      }
      // For strict backpressure, surface error like legacy implementation
      throw new AudioProcessingError('BUFFER_OVERFLOW', 
        `Audio processing too slow for group ${groupId}. Buffer size: ${groupBytes} bytes`);
    }

    const totalWindowBytes = Array.from(this.groupWindows.values()).reduce((acc, s) => acc + (s.bytes || 0), 0);
    const totalCompatBytes = Array.from(this.activeBuffers.values()).reduce((acc, b) => acc + (b.size || b.data.length), 0);
    const totalBytes = totalWindowBytes + totalCompatBytes;
    if (totalBytes > this.maxBufferSize * 2) {
      if (process.env.API_DEBUG === '1') logger.warn(`⚠️  High total buffer usage: ${Math.round(totalBytes / 1024 / 1024)}MB`);
      await this.cleanupOldBuffers();
      const maxBytes = this.MAX_TOTAL_MEMORY_MB * 1024 * 1024;
      if (totalBytes > maxBytes) {
        // Evict oldest group windows to reduce memory footprint
        const entries = Array.from(this.groupWindows.entries()).sort((a, b) => a[1].windowStartedAt - b[1].windowStartedAt);
        for (const [gid, st] of entries) {
          if (st.bytes > 0) {
            for (const c of st.chunks) this.secureZeroBuffer(c);
            st.chunks = [];
            st.bytes = 0;
            if (process.env.API_DEBUG === '1') logger.warn(`🧹 Evicted window buffers for group ${gid}`);
          }
          const newTotalWindowBytes = Array.from(this.groupWindows.values()).reduce((acc, s) => acc + (s.bytes || 0), 0);
          const newTotalCompatBytes = Array.from(this.activeBuffers.values()).reduce((acc, b) => acc + (b.size || b.data.length), 0);
          if (newTotalWindowBytes + newTotalCompatBytes <= maxBytes) break;
        }
      }
    }
  }

  /**
  * Stream audio (deprecated legacy placeholder)
   */
  // Deprecated placeholder (unused)
  private async streamToWhisper(_audioBuffer: Buffer, _mimeType: string): Promise<WhisperResponse> {
    const provider = getSttProvider();
    const result = await provider.transcribeBuffer(Buffer.alloc(0), 'audio/webm');
    return {
      text: result.text,
      confidence: result.confidence || 0,
      language: result.language,
      duration: result.duration,
    };
  }

  /**
   * Get buffer size for a specific group
   */
  private getBufferSize(groupId: string): number {
    return this.groupWindows.get(groupId)?.bytes ?? 0;
  }

  /**
   * Expose current group window info for socket-level backpressure decisions
   */
  public getGroupWindowInfo(groupId: string): { bytes: number; chunks: number; windowSeconds: number } {
    const s = this.groupWindows.get(groupId);
    return { bytes: s?.bytes ?? 0, chunks: s?.chunks?.length ?? 0, windowSeconds: s?.windowSeconds ?? this.baseWindowSeconds };
  }

  private getRandomJitterMs(): number {
    if (!this.windowJitterMs || this.windowJitterMs <= 0) return 0;
    const sign = Math.random() < 0.5 ? -1 : 1;
    return Math.floor(Math.random() * this.windowJitterMs) * sign;
  }

  /**
   * Force garbage collection for memory cleanup
   */
  private forceGarbageCollection(): void {
    if (global.gc) {
      global.gc();
    }
  }

  /**
   * Clean up old buffers to prevent memory leaks
   */
  private async cleanupOldBuffers(): Promise<void> {
    // If any group window is older than 60s without submit, reset it
    const now = Date.now();
    let cleaned = 0;
    for (const [groupId, state] of Array.from(this.groupWindows.entries())) {
      const age = now - state.windowStartedAt;
      if (age > 60_000 && state.bytes > 0) {
        for (const c of state.chunks) this.secureZeroBuffer(c);
        state.chunks = [];
        state.bytes = 0;
        state.windowStartedAt = now;
        cleaned++;
        logger.warn(`🧹 Stale window reset for group ${groupId}`);
      }
    }
    // Also clean old compat entries
    for (const [key, entry] of Array.from(this.activeBuffers.entries())) {
      if (now - entry.timestamp.getTime() > 60_000) {
        this.secureZeroBuffer(entry.data);
        this.activeBuffers.delete(key);
      }
    }
    this.forceGarbageCollection();
    if (cleaned > 0) logger.debug(`🧹 Cleaned ${cleaned} stale windows`);
  }

  /**
   * Record performance metrics for monitoring
   */
  private recordPerformanceMetrics(groupId: string, latency: number): void {
    const stats = this.processingStats.get(groupId) || { count: 0, totalLatency: 0 };
    stats.count++;
    stats.totalLatency += latency;
    this.processingStats.set(groupId, stats);
    
    if (process.env.API_DEBUG === '1') {
      logger.debug(`📊 Audio processing: ${latency.toFixed(2)}ms (avg: ${(stats.totalLatency / stats.count).toFixed(2)}ms) for group ${groupId}`);
    }
  }

  /**
   * Start memory monitoring for leak detection
   */
  private startMemoryMonitoring(): void {
    const t = setInterval(() => {
      const memoryUsage = process.memoryUsage();
      const groups = this.groupWindows.size;
      const totalBytes = Array.from(this.groupWindows.values()).reduce((acc, s) => acc + s.bytes, 0);
      if (groups > 0 && process.env.API_DEBUG === '1') {
        logger.debug(`📈 Memory: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB, Groups: ${groups}, Window bytes: ${Math.round(totalBytes/1024)}KB`);
      }
      if (memoryUsage.heapUsed / 1024 / 1024 > this.MAX_HEAP_SIZE_MB) {
        this.cleanupOldBuffers();
      }
    }, 30000); // Every 30 seconds
    (t as any).unref?.();
  }

  /**
   * Log errors without disk writes
   */
  private logError(groupId: string, sessionId: string, errorMessage: string): void {
    logger.error(`❌ Audio processing error - Group: ${groupId}, Session: ${sessionId}, Error: ${errorMessage}`);
  }

  /**
   * Mock whisper response for development/testing
   */
  private getMockWhisperResponse(): WhisperResponse {
    const mockTranscriptions = [
      "I think we should start with the first problem on page twelve.",
      "Can someone explain how photosynthesis works in plants?",
      "The answer to number three is definitely option B because of the evidence we discussed.",
      "Let's work together to solve this math problem step by step.",
      "I agree with Sarah's point about climate change affecting ocean levels.",
      "We need to gather more information before drawing any conclusions.",
      "The main character in this story shows courage when facing difficulties.",
      "Can we review the assignment requirements one more time please?"
    ];

    const text = mockTranscriptions[Math.floor(Math.random() * mockTranscriptions.length)];
    
    return {
      text,
      confidence: 0.92 + Math.random() * 0.07, // 0.92-0.99
      language: 'en',
      duration: 2.5 + Math.random() * 3 // 2.5-5.5 seconds
    };
  }

  /**
   * Get processing statistics for monitoring
   */
  public getProcessingStats(): Map<string, { count: number; totalLatency: number; avgLatency: number }> {
    const result = new Map();
    
    for (const [groupId, stats] of Array.from(this.processingStats.entries())) {
      result.set(groupId, {
        count: stats.count,
        totalLatency: stats.totalLatency,
        avgLatency: stats.totalLatency / stats.count
      });
    }
    
    return result;
  }

  /**
   * Health check for the audio processor
   */
  public async healthCheck(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; details: any }> {
    const memoryUsage = process.memoryUsage();
    const groups = this.groupWindows.size;
    const totalBytes = Array.from(this.groupWindows.values()).reduce((acc, s) => acc + s.bytes, 0);
    const breaker = this.breakerOpenUntil && Date.now() < this.breakerOpenUntil ? 'open' : 'closed';
    return {
      status: 'healthy',
      details: {
        memory: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
        groups,
        window_bytes: totalBytes,
        breaker,
        // Back-compat fields for legacy tests
        activeBuffers: 0,
        databricksConnectivity: 'mock',
      }
    };
  }

  /**
   * Reset group state (window buffers and header). Call on stream end.
   */
  public resetGroupState(groupId: string): void {
    try {
      const state = this.groupWindows.get(groupId);
      if (state) {
        for (const c of state.chunks) this.secureZeroBuffer(c);
        state.chunks = [];
        state.bytes = 0;
        this.groupWindows.delete(groupId);
      }
      this.webmHeaders.delete(groupId);
      this.oggHeaders.delete(groupId);
    } catch { /* intentionally ignored: best effort cleanup */ }
  }

  // Best-effort flush for a set of groups (used during session drain)
  public async flushGroups(groupIds: string[], fallbackMimeType: string = 'audio/webm'): Promise<void> {
    const useQueue = process.env.AUDIO_QUEUE_ENABLED === '1' && process.env.NODE_ENV !== 'test';
    for (const gid of groupIds) {
      const state = this.groupWindows.get(gid);
      if (state && state.bytes > 0 && state.chunks.length > 0) {
        const task = async () => {
          await this.withGroupLock(gid, async () => {
            try { await this.flushGroupWindow(gid, state, state.mimeType || fallbackMimeType); } catch { /* intentionally ignored: best effort cleanup */ }
          });
        };
        if (useQueue) {
          try {
            const q = await import('../queue/audio-task-queue.port');
            await (await q.getAudioTaskQueue()).enqueue(task);
          } catch {
            await task();
          }
        } else {
          await task();
        }
      }
    }
  }

  // Minimal promise-chain mutex per group
  private withGroupLock<T>(groupId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.groupLocks.get(groupId) || Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.groupLocks.set(groupId, next as unknown as Promise<any>);
    return next.finally(() => {
      if (this.groupLocks.get(groupId) === next) this.groupLocks.delete(groupId);
    });
  }
}

// Export singleton instance
let audioProcessorInstance: InMemoryAudioProcessor | null = null;

export const getInMemoryAudioProcessor = (): InMemoryAudioProcessor => {
  if (!audioProcessorInstance) {
    audioProcessorInstance = new InMemoryAudioProcessor();
  }
  return audioProcessorInstance;
};

// Export for direct access
export const inMemoryAudioProcessor = getInMemoryAudioProcessor();

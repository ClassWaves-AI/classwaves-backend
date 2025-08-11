/**
 * AI Analysis Buffering Service
 * 
 * Manages in-memory buffering of transcriptions for AI analysis with:
 * - FERPA/COPPA compliance (group-level analysis only)
 * - Zero disk storage (strictly in-memory processing)
 * - Comprehensive audit logging
 * - Automatic memory cleanup
 */

import { z } from 'zod';
import { databricksService } from './databricks.service';

// ============================================================================
// Input Validation Schemas
// ============================================================================

const transcriptionSchema = z.object({
  groupId: z.string().uuid('Invalid group ID format'),
  sessionId: z.string().uuid('Invalid session ID format'),
  transcription: z.string().min(1, 'Transcription cannot be empty').max(10000, 'Transcription too long'),
  timestamp: z.date()
});

const bufferOptionsSchema = z.object({
  maxBufferSize: z.number().min(1).max(100).default(50),
  maxBufferAgeMs: z.number().min(1000).max(300000).default(60000), // 1 minute default
  tier1WindowMs: z.number().min(5000).max(120000).default(30000), // 30 seconds
  tier2WindowMs: z.number().min(60000).max(600000).default(180000), // 3 minutes
}).optional();

// ============================================================================
// Buffer Types
// ============================================================================

interface TranscriptBuffer {
  transcripts: Array<{
    content: string;
    timestamp: Date;
    sequenceNumber: number;
  }>;
  windowStart: Date;
  lastUpdate: Date;
  lastAnalysis?: Date;
  groupId: string;
  sessionId: string;
  sequenceCounter: number;
}

interface BufferStats {
  totalBuffers: number;
  totalTranscripts: number;
  memoryUsageBytes: number;
  oldestBuffer?: Date;
  newestBuffer?: Date;
}

// ============================================================================
// AI Analysis Buffer Service
// ============================================================================

export class AIAnalysisBufferService {
  private tier1Buffers = new Map<string, TranscriptBuffer>();
  private tier2Buffers = new Map<string, TranscriptBuffer>();
  private cleanupInterval: NodeJS.Timeout | null = null;
  
  private readonly config = {
    maxBufferSize: parseInt(process.env.AI_BUFFER_MAX_SIZE || '50'),
    maxBufferAgeMs: parseInt(process.env.AI_BUFFER_MAX_AGE_MS || '60000'),
    tier1WindowMs: parseInt(process.env.AI_TIER1_WINDOW_MS || '30000'),
    tier2WindowMs: parseInt(process.env.AI_TIER2_WINDOW_MS || '180000'),
    cleanupIntervalMs: parseInt(process.env.AI_BUFFER_CLEANUP_INTERVAL_MS || '30000'),
  };

  constructor() {
    // Start automatic cleanup process
    this.startCleanupProcess();
    
    console.log('🔄 AI Analysis Buffer Service initialized', {
      maxBufferSize: this.config.maxBufferSize,
      tier1WindowMs: this.config.tier1WindowMs,
      tier2WindowMs: this.config.tier2WindowMs,
    });
  }

  // ============================================================================
  // Public Methods
  // ============================================================================

  /**
   * Buffer transcription for AI analysis processing
   * 
   * ✅ COMPLIANCE: Group-level analysis only (no individual student identification)
   * ✅ SECURITY: Input validation with Zod schemas
   * ✅ AUDIT: Comprehensive logging for educational data processing
   * ✅ MEMORY: In-memory only with automatic cleanup
   */
  async bufferTranscription(
    groupId: string,
    sessionId: string,
    transcription: string,
    options?: z.infer<typeof bufferOptionsSchema>
  ): Promise<void> {
    const startTime = Date.now();
    
    try {
      // ✅ SECURITY: Input validation
      const validated = transcriptionSchema.parse({
        groupId,
        sessionId,
        transcription,
        timestamp: new Date()
      });

      const validatedOptions = bufferOptionsSchema.parse(options || {});

      // ✅ COMPLIANCE: Audit logging for educational data processing
      await this.auditLog({
        eventType: 'ai_analysis_buffer',
        actorId: 'system',
        targetType: 'group_transcription',
        targetId: groupId,
        educationalPurpose: 'Buffer transcripts for AI analysis to provide educational insights',
        complianceBasis: 'legitimate_educational_interest',
        sessionId,
        transcriptionLength: transcription.length
      });

      // Add to both tier buffers
      await Promise.all([
        this.addToBuffer('tier1', validated, validatedOptions),
        this.addToBuffer('tier2', validated, validatedOptions)
      ]);

      // ✅ MEMORY: Force garbage collection after processing
      if (global.gc) {
        global.gc();
      }

      const processingTime = Date.now() - startTime;
      console.log(`✅ Buffered transcription for group ${groupId} in ${processingTime}ms`);

    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`❌ Failed to buffer transcription for group ${groupId}:`, error);
      
      // ✅ COMPLIANCE: Audit log for errors
      await this.auditLog({
        eventType: 'ai_analysis_buffer_error',
        actorId: 'system',
        targetType: 'group_transcription',
        targetId: groupId,
        educationalPurpose: 'Log transcription buffering error for system monitoring',
        complianceBasis: 'system_administration',
        sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw error;
    }
  }

  /**
   * Get buffered transcriptions for analysis
   * 
   * ✅ COMPLIANCE: Returns group-level data only
   * ✅ MEMORY: Does not persist data to disk
   */
  async getBufferedTranscripts(
    tier: 'tier1' | 'tier2',
    groupId: string,
    sessionId: string
  ): Promise<string[]> {
    try {
      const buffers = tier === 'tier1' ? this.tier1Buffers : this.tier2Buffers;
      const bufferKey = `${sessionId}:${groupId}`;
      const buffer = buffers.get(bufferKey);

      if (!buffer) {
        return [];
      }

      // ✅ COMPLIANCE: Audit data access
      await this.auditLog({
        eventType: 'ai_analysis_buffer_access',
        actorId: 'system',
        targetType: 'group_transcription_buffer',
        targetId: groupId,
        educationalPurpose: `Access buffered transcripts for ${tier} AI analysis`,
        complianceBasis: 'legitimate_educational_interest',
        sessionId,
        bufferSize: buffer.transcripts.length
      });

      // Return transcripts as string array
      return buffer.transcripts.map(t => t.content);

    } catch (error) {
      console.error(`❌ Failed to get buffered transcripts for group ${groupId}:`, error);
      throw error;
    }
  }

  /**
   * Mark buffer as analyzed to optimize future processing
   */
  async markBufferAnalyzed(
    tier: 'tier1' | 'tier2',
    groupId: string,
    sessionId: string
  ): Promise<void> {
    const buffers = tier === 'tier1' ? this.tier1Buffers : this.tier2Buffers;
    const bufferKey = `${sessionId}:${groupId}`;
    const buffer = buffers.get(bufferKey);

    if (buffer) {
      buffer.lastAnalysis = new Date();
      
      // ✅ COMPLIANCE: Audit analysis completion
      await this.auditLog({
        eventType: 'ai_analysis_buffer_analyzed',
        actorId: 'system',
        targetType: 'group_transcription_buffer',
        targetId: groupId,
        educationalPurpose: `Mark ${tier} analysis completion for optimization`,
        complianceBasis: 'system_administration',
        sessionId
      });
    }
  }

  /**
   * Get buffer statistics for monitoring
   */
  getBufferStats(): { tier1: BufferStats; tier2: BufferStats } {
    return {
      tier1: this.calculateBufferStats(this.tier1Buffers),
      tier2: this.calculateBufferStats(this.tier2Buffers)
    };
  }

  /**
   * Manually trigger cleanup process
   */
  async cleanup(): Promise<void> {
    await this.performCleanup();
  }

  /**
   * Shutdown service and cleanup resources
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    this.tier1Buffers.clear();
    this.tier2Buffers.clear();
    
    // ✅ MEMORY: Force garbage collection
    if (global.gc) {
      global.gc();
    }
    
    console.log('🛑 AI Analysis Buffer Service shutdown completed');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async addToBuffer(
    tier: 'tier1' | 'tier2',
    validated: z.infer<typeof transcriptionSchema>,
    options: z.infer<typeof bufferOptionsSchema>
  ): Promise<void> {
    const buffers = tier === 'tier1' ? this.tier1Buffers : this.tier2Buffers;
    const bufferKey = `${validated.sessionId}:${validated.groupId}`;
    
    let buffer = buffers.get(bufferKey);
    
    if (!buffer) {
      buffer = {
        transcripts: [],
        windowStart: validated.timestamp,
        lastUpdate: validated.timestamp,
        groupId: validated.groupId,
        sessionId: validated.sessionId,
        sequenceCounter: 0
      };
      buffers.set(bufferKey, buffer);
    }

    // Add transcript with sequence number
    buffer.transcripts.push({
      content: validated.transcription,
      timestamp: validated.timestamp,
      sequenceNumber: ++buffer.sequenceCounter
    });
    
    buffer.lastUpdate = validated.timestamp;

    // Enforce buffer size limits
    const maxSize = options?.maxBufferSize || this.config.maxBufferSize;
    if (buffer.transcripts.length > maxSize) {
      buffer.transcripts = buffer.transcripts.slice(-maxSize);
    }
  }

  private calculateBufferStats(buffers: Map<string, TranscriptBuffer>): BufferStats {
    let totalTranscripts = 0;
    let memoryUsageBytes = 0;
    let oldestBuffer: Date | undefined;
    let newestBuffer: Date | undefined;

    for (const buffer of buffers.values()) {
      totalTranscripts += buffer.transcripts.length;
      
      // Estimate memory usage
      for (const transcript of buffer.transcripts) {
        memoryUsageBytes += transcript.content.length * 2; // Rough estimate for UTF-16
      }
      
      if (!oldestBuffer || buffer.windowStart < oldestBuffer) {
        oldestBuffer = buffer.windowStart;
      }
      
      if (!newestBuffer || buffer.lastUpdate > newestBuffer) {
        newestBuffer = buffer.lastUpdate;
      }
    }

    return {
      totalBuffers: buffers.size,
      totalTranscripts,
      memoryUsageBytes,
      oldestBuffer,
      newestBuffer
    };
  }

  private startCleanupProcess(): void {
    this.cleanupInterval = setInterval(() => {
      this.performCleanup().catch(error => {
        console.error('❌ Buffer cleanup failed:', error);
      });
    }, this.config.cleanupIntervalMs);
  }

  private async performCleanup(): Promise<void> {
    const now = new Date();
    let cleanedCount = 0;

    // Clean tier1 buffers (shorter retention)
    cleanedCount += this.cleanupBufferMap(this.tier1Buffers, now, this.config.tier1WindowMs * 2);
    
    // Clean tier2 buffers (longer retention)
    cleanedCount += this.cleanupBufferMap(this.tier2Buffers, now, this.config.tier2WindowMs * 2);

    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} old buffers`);
      
      // ✅ MEMORY: Force garbage collection after cleanup
      if (global.gc) {
        global.gc();
      }
    }
  }

  private cleanupBufferMap(
    buffers: Map<string, TranscriptBuffer>,
    now: Date,
    maxAgeMs: number
  ): number {
    let cleanedCount = 0;
    
    for (const [key, buffer] of buffers.entries()) {
      const age = now.getTime() - buffer.lastUpdate.getTime();
      if (age > maxAgeMs) {
        buffers.delete(key);
        cleanedCount++;
      }
    }
    
    return cleanedCount;
  }

  private async auditLog(data: {
    eventType: string;
    actorId: string;
    targetType: string;
    targetId: string;
    educationalPurpose: string;
    complianceBasis: string;
    sessionId: string;
    transcriptionLength?: number;
    bufferSize?: number;
    error?: string;
  }): Promise<void> {
    try {
      await databricksService.recordAuditLog({
        actorId: data.actorId,
        actorType: 'system',
        eventType: data.eventType,
        eventCategory: 'data_access',
        resourceType: data.targetType,
        resourceId: data.targetId,
        schoolId: 'system', // System-level operation
        description: `${data.educationalPurpose} - Session: ${data.sessionId}`,
        complianceBasis: 'legitimate_interest',
        dataAccessed: data.transcriptionLength ? `transcription_${data.transcriptionLength}_chars` : 'buffer_metadata'
      });
    } catch (error) {
      // Don't fail the main operation if audit logging fails
      console.warn('⚠️ Audit logging failed in AI buffer service:', error);
    }
  }
}

// ============================================================================
// Export Singleton Instance
// ============================================================================

export const aiAnalysisBufferService = new AIAnalysisBufferService();

// Graceful shutdown handling
process.on('SIGTERM', () => {
  aiAnalysisBufferService.shutdown();
});

process.on('SIGINT', () => {
  aiAnalysisBufferService.shutdown();
});

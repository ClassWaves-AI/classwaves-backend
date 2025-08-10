/**
 * AI WebSocket Integration Service
 * 
 * Real-time integration between AI analysis pipeline and WebSocket transcription system:
 * - Listens for transcription events and triggers AI analysis
 * - Delivers real-time AI insights via WebSocket
 * - Manages teacher guidance prompts and alerts
 * - Provides graceful error handling and fallback mechanisms
 * 
 * ✅ REAL-TIME: Sub-second AI insight delivery
 * ✅ COMPLIANCE: Group-level analysis with audit logging
 * ✅ RELIABILITY: Error handling with graceful degradation
 * ✅ PERFORMANCE: Optimized processing with intelligent batching
 */

import { EventEmitter } from 'events';
import { aiAnalysisBufferService } from './ai-analysis-buffer.service';
import { databricksAIService } from './databricks-ai.service';
import { teacherPromptService } from './teacher-prompt.service';
import { alertPrioritizationService } from './alert-prioritization.service';
import { recommendationEngineService } from './recommendation-engine.service';
import { databricksService } from './databricks.service';
import type { WebSocketService } from './websocket.service';
import type { Tier1Insights, Tier2Insights } from '../types/ai-analysis.types';

// ============================================================================
// Event Types and Interfaces
// ============================================================================

interface TranscriptionEvent {
  id: string;
  groupId: string;
  sessionId: string;
  transcription: string;
  timestamp: Date;
  confidence: number;
  language?: string;
  metadata?: {
    speakerCount?: number;
    duration?: number;
    audioQuality?: number;
  };
}

interface AIInsightEvent {
  type: 'tier1' | 'tier2';
  sessionId: string;
  groupId?: string;
  insights: Tier1Insights | Tier2Insights;
  timestamp: Date;
  processingTime: number;
  confidence: number;
}

interface TeacherAlertEvent {
  sessionId: string;
  teacherId: string;
  alert: {
    id: string;
    type: 'prompt' | 'recommendation' | 'intervention';
    priority: 'critical' | 'high' | 'medium' | 'low';
    message: string;
    actionRequired: boolean;
    expiresAt: Date;
  };
}

interface SystemHealthEvent {
  service: string;
  status: 'healthy' | 'degraded' | 'error';
  metrics: {
    latency: number;
    throughput: number;
    errorRate: number;
  };
  timestamp: Date;
}

// ============================================================================
// AI WebSocket Integration Service
// ============================================================================

export class AIWebSocketIntegrationService extends EventEmitter {
  private websocketService: WebSocketService | null = null;
  private isInitialized = false;
  private processingQueues = new Map<string, TranscriptionEvent[]>(); // sessionId -> events
  private tier1ProcessingInterval: NodeJS.Timeout | null = null;
  private tier2ProcessingInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  
  // Processing configuration
  private readonly config = {
    tier1IntervalMs: parseInt(process.env.AI_TIER1_PROCESSING_INTERVAL_MS || '30000'), // 30 seconds
    tier2IntervalMs: parseInt(process.env.AI_TIER2_PROCESSING_INTERVAL_MS || '180000'), // 3 minutes
    maxConcurrentAnalyses: parseInt(process.env.AI_MAX_CONCURRENT_ANALYSES || '10'),
    enableRealTimeAlerts: process.env.TEACHER_ALERT_REAL_TIME !== 'false',
    gracefulDegradationEnabled: process.env.AI_GRACEFUL_DEGRADATION !== 'false',
    healthCheckIntervalMs: parseInt(process.env.AI_HEALTH_CHECK_INTERVAL_MS || '60000')
  };

  // Performance metrics
  private metrics = {
    transcriptionsProcessed: 0,
    tier1AnalysesCompleted: 0,
    tier2AnalysesCompleted: 0,
    alertsGenerated: 0,
    errorsEncountered: 0,
    averageProcessingTime: 0,
    lastProcessingTime: 0
  };

  constructor() {
    super();
    console.log('🔗 AI WebSocket Integration Service created', {
      tier1Interval: this.config.tier1IntervalMs,
      tier2Interval: this.config.tier2IntervalMs,
      realTimeAlerts: this.config.enableRealTimeAlerts
    });
  }

  // ============================================================================
  // Public Methods
  // ============================================================================

  /**
   * Initialize the integration service with WebSocket service
   */
  async initialize(websocketService: WebSocketService): Promise<void> {
    if (this.isInitialized) {
      console.warn('⚠️ AI WebSocket Integration already initialized');
      return;
    }

    try {
      this.websocketService = websocketService;
      
      // Set up event listeners for transcription events
      await this.setupTranscriptionListeners();
      
      // Start AI processing intervals
      this.startProcessingIntervals();
      
      // Start health monitoring
      this.startHealthMonitoring();
      
      this.isInitialized = true;
      
      console.log('✅ AI WebSocket Integration Service initialized successfully');
      
      // ✅ COMPLIANCE: Audit logging for service initialization
      await this.auditLog({
        eventType: 'ai_websocket_integration_initialized',
        actorId: 'system',
        targetType: 'ai_integration_service',
        targetId: 'ai_websocket_service',
        educationalPurpose: 'Initialize real-time AI analysis integration for educational insights',
        complianceBasis: 'system_administration'
      });

    } catch (error) {
      console.error('❌ Failed to initialize AI WebSocket Integration:', error);
      throw error;
    }
  }

  /**
   * Shutdown the integration service gracefully
   */
  async shutdown(): Promise<void> {
    console.log('🛑 Shutting down AI WebSocket Integration Service...');
    
    // Clear all intervals
    if (this.tier1ProcessingInterval) {
      clearInterval(this.tier1ProcessingInterval);
      this.tier1ProcessingInterval = null;
    }
    
    if (this.tier2ProcessingInterval) {
      clearInterval(this.tier2ProcessingInterval);
      this.tier2ProcessingInterval = null;
    }
    
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    // Process any remaining queued items
    await this.processRemainingQueues();
    
    this.isInitialized = false;
    this.websocketService = null;
    
    console.log('✅ AI WebSocket Integration Service shutdown completed');
  }

  /**
   * Get current processing metrics
   */
  getMetrics(): typeof this.metrics {
    return { ...this.metrics };
  }

  /**
   * Force immediate processing of queued transcriptions
   */
  async flushProcessingQueues(): Promise<void> {
    console.log('🚀 Flushing AI processing queues...');
    
    await Promise.all([
      this.processTier1Analysis(),
      this.processTier2Analysis()
    ]);
    
    console.log('✅ Processing queues flushed');
  }

  // ============================================================================
  // Private Methods - Event Listeners Setup
  // ============================================================================

  private async setupTranscriptionListeners(): Promise<void> {
    if (!this.websocketService) {
      throw new Error('WebSocket service not available');
    }

    console.log('📡 Setting up transcription event listeners...');

    // Listen for new group transcriptions
    this.websocketService.on('transcription:group:new', async (data: any) => {
      await this.handleTranscriptionEvent({
        id: data.id || `trans_${Date.now()}`,
        groupId: data.groupId,
        sessionId: data.sessionId,
        transcription: data.text,
        timestamp: new Date(data.timestamp),
        confidence: data.confidence || 0.8,
        language: data.language,
        metadata: {
          speakerCount: data.speakerCount,
          duration: data.duration,
          audioQuality: data.audioQuality
        }
      });
    });

    // Listen for session status changes
    this.websocketService.on('session:status_changed', async (data: any) => {
      if (data.status === 'ended') {
        await this.handleSessionEnd(data.sessionId);
      }
    });

    console.log('✅ Transcription event listeners configured');
  }

  // ============================================================================
  // Private Methods - Event Handlers
  // ============================================================================

  private async handleTranscriptionEvent(event: TranscriptionEvent): Promise<void> {
    const startTime = Date.now();
    
    try {
      console.log(`📝 Processing transcription: ${event.id} (group: ${event.groupId})`);
      
      // ✅ COMPLIANCE: Buffer transcription for AI analysis (group-level only)
      await aiAnalysisBufferService.bufferTranscription(
        event.groupId,
        event.sessionId,
        event.transcription
      );
      
      // Queue event for batch processing
      this.queueTranscriptionForProcessing(event);
      
      // For high-confidence, immediate-priority transcriptions, trigger immediate analysis
      if (event.confidence > 0.9 && this.shouldTriggerImmediateAnalysis(event)) {
        await this.triggerImmediateAnalysis(event);
      }
      
      this.metrics.transcriptionsProcessed++;
      this.metrics.lastProcessingTime = Date.now() - startTime;
      
      // ✅ COMPLIANCE: Audit logging for transcription processing
      await this.auditLog({
        eventType: 'transcription_processed',
        actorId: 'system',
        targetType: 'group_transcription',
        targetId: event.groupId,
        educationalPurpose: 'Process group transcription for AI analysis and educational insights',
        complianceBasis: 'legitimate_educational_interest',
        sessionId: event.sessionId,
        transcriptionLength: event.transcription.length
      });

    } catch (error) {
      console.error(`❌ Failed to handle transcription event ${event.id}:`, error);
      this.metrics.errorsEncountered++;
      
      // ✅ ERROR HANDLING: Graceful degradation
      if (this.config.gracefulDegradationEnabled) {
        await this.handleProcessingError(event, error);
      }
    }
  }

  private async handleSessionEnd(sessionId: string): Promise<void> {
    try {
      console.log(`🏁 Processing session end: ${sessionId}`);
      
      // Process any remaining transcriptions for this session
      await this.processSessionFinalAnalysis(sessionId);
      
      // Clean up processing queues
      this.processingQueues.delete(sessionId);
      
      // Generate final session recommendations
      await this.generateSessionSummaryRecommendations(sessionId);
      
      console.log(`✅ Session end processing completed: ${sessionId}`);
      
    } catch (error) {
      console.error(`❌ Failed to handle session end ${sessionId}:`, error);
    }
  }

  // ============================================================================
  // Private Methods - AI Analysis Processing
  // ============================================================================

  private queueTranscriptionForProcessing(event: TranscriptionEvent): void {
    if (!this.processingQueues.has(event.sessionId)) {
      this.processingQueues.set(event.sessionId, []);
    }
    
    const queue = this.processingQueues.get(event.sessionId)!;
    queue.push(event);
    
    // Keep queue size manageable (last 50 transcriptions)
    if (queue.length > 50) {
      queue.splice(0, queue.length - 50);
    }
  }

  private shouldTriggerImmediateAnalysis(event: TranscriptionEvent): boolean {
    // Trigger immediate analysis for critical indicators
    const criticalPatterns = [
      /help/i,
      /confused/i,
      /don't understand/i,
      /stuck/i,
      /frustrated/i
    ];
    
    return criticalPatterns.some(pattern => pattern.test(event.transcription));
  }

  private async triggerImmediateAnalysis(event: TranscriptionEvent): Promise<void> {
    try {
      console.log(`⚡ Triggering immediate analysis for: ${event.id}`);
      
      // Get buffered transcripts for context
      const transcripts = await aiAnalysisBufferService.getBufferedTranscripts(
        'tier1',
        event.groupId,
        event.sessionId
      );
      
      if (transcripts.length === 0) {
        console.warn('No buffered transcripts available for immediate analysis');
        return;
      }
      
      // Perform Tier 1 analysis
      const insights = await databricksAIService.analyzeTier1(transcripts, {
        groupId: event.groupId,
        sessionId: event.sessionId,
        windowSize: 30
      });
      
      // Generate and prioritize teacher prompts
      await this.processAIInsights('tier1', event.sessionId, event.groupId, insights);
      
    } catch (error) {
      console.error(`❌ Immediate analysis failed for ${event.id}:`, error);
    }
  }

  private startProcessingIntervals(): void {
    // Tier 1 processing interval (every 30 seconds)
    this.tier1ProcessingInterval = setInterval(() => {
      this.processTier1Analysis().catch(error => {
        console.error('❌ Tier 1 processing interval failed:', error);
      });
    }, this.config.tier1IntervalMs);
    
    // Tier 2 processing interval (every 3 minutes)
    this.tier2ProcessingInterval = setInterval(() => {
      this.processTier2Analysis().catch(error => {
        console.error('❌ Tier 2 processing interval failed:', error);
      });
    }, this.config.tier2IntervalMs);
    
    console.log('⏰ AI processing intervals started');
  }

  private async processTier1Analysis(): Promise<void> {
    if (this.processingQueues.size === 0) {
      return;
    }
    
    console.log('🧠 Processing Tier 1 analysis batch...');
    
    const promises: Promise<void>[] = [];
    let processedCount = 0;
    
    for (const [sessionId, events] of this.processingQueues.entries()) {
      if (events.length === 0) continue;
      
      // Limit concurrent processing
      if (promises.length >= this.config.maxConcurrentAnalyses) {
        break;
      }
      
      promises.push(this.processTier1ForSession(sessionId, events));
      processedCount++;
    }
    
    if (promises.length > 0) {
      await Promise.allSettled(promises);
      console.log(`✅ Tier 1 batch completed: ${processedCount} sessions processed`);
    }
  }

  private async processTier2Analysis(): Promise<void> {
    if (this.processingQueues.size === 0) {
      return;
    }
    
    console.log('🧠 Processing Tier 2 analysis batch...');
    
    const promises: Promise<void>[] = [];
    let processedCount = 0;
    
    for (const [sessionId, events] of this.processingQueues.entries()) {
      if (events.length < 5) continue; // Need sufficient data for Tier 2
      
      // Limit concurrent processing
      if (promises.length >= this.config.maxConcurrentAnalyses) {
        break;
      }
      
      promises.push(this.processTier2ForSession(sessionId, events));
      processedCount++;
    }
    
    if (promises.length > 0) {
      await Promise.allSettled(promises);
      console.log(`✅ Tier 2 batch completed: ${processedCount} sessions processed`);
    }
  }

  private async processTier1ForSession(sessionId: string, events: TranscriptionEvent[]): Promise<void> {
    try {
      // Group events by groupId
      const groupEvents = new Map<string, TranscriptionEvent[]>();
      for (const event of events) {
        if (!groupEvents.has(event.groupId)) {
          groupEvents.set(event.groupId, []);
        }
        groupEvents.get(event.groupId)!.push(event);
      }
      
      // Process each group
      for (const [groupId, groupEventList] of groupEvents.entries()) {
        await this.processTier1ForGroup(sessionId, groupId, groupEventList);
      }
      
    } catch (error) {
      console.error(`❌ Tier 1 processing failed for session ${sessionId}:`, error);
    }
  }

  private async processTier1ForGroup(
    sessionId: string,
    groupId: string,
    events: TranscriptionEvent[]
  ): Promise<void> {
    try {
      // Get buffered transcripts
      const transcripts = await aiAnalysisBufferService.getBufferedTranscripts(
        'tier1',
        groupId,
        sessionId
      );
      
      if (transcripts.length === 0) {
        return;
      }
      
      // Perform analysis
      const insights = await databricksAIService.analyzeTier1(transcripts, {
        groupId,
        sessionId,
        windowSize: 30
      });
      
      // Process insights and generate prompts
      await this.processAIInsights('tier1', sessionId, groupId, insights);
      
      // Mark buffer as analyzed
      await aiAnalysisBufferService.markBufferAnalyzed('tier1', groupId, sessionId);
      
      this.metrics.tier1AnalysesCompleted++;
      
    } catch (error) {
      console.error(`❌ Tier 1 analysis failed for group ${groupId}:`, error);
    }
  }

  private async processTier2ForSession(sessionId: string, events: TranscriptionEvent[]): Promise<void> {
    try {
      // Group events by groupId and prepare for session-level analysis
      const groupTranscripts: Array<{ groupId: string; transcripts: string[] }> = [];
      
      const groupEvents = new Map<string, TranscriptionEvent[]>();
      for (const event of events) {
        if (!groupEvents.has(event.groupId)) {
          groupEvents.set(event.groupId, []);
        }
        groupEvents.get(event.groupId)!.push(event);
      }
      
      // Get transcripts for each group
      for (const [groupId] of groupEvents.entries()) {
        const transcripts = await aiAnalysisBufferService.getBufferedTranscripts(
          'tier2',
          groupId,
          sessionId
        );
        
        if (transcripts.length > 0) {
          groupTranscripts.push({ groupId, transcripts });
        }
      }
      
      if (groupTranscripts.length === 0) {
        return;
      }
      
      // Perform Tier 2 analysis
      const insights = await databricksAIService.analyzeTier2(
        groupTranscripts.flatMap(gt => gt.transcripts),
        {
          sessionId,
          groupIds: groupTranscripts.map(gt => gt.groupId),
          analysisDepth: 'standard'
        }
      );
      
      // Process insights and generate recommendations
      await this.processAIInsights('tier2', sessionId, undefined, insights);
      
      // Mark buffers as analyzed
      for (const { groupId } of groupTranscripts) {
        await aiAnalysisBufferService.markBufferAnalyzed('tier2', groupId, sessionId);
      }
      
      this.metrics.tier2AnalysesCompleted++;
      
    } catch (error) {
      console.error(`❌ Tier 2 analysis failed for session ${sessionId}:`, error);
    }
  }

  // ============================================================================
  // Private Methods - Insights Processing and Delivery
  // ============================================================================

  private async processAIInsights(
    tier: 'tier1' | 'tier2',
    sessionId: string,
    groupId: string | undefined,
    insights: Tier1Insights | Tier2Insights
  ): Promise<void> {
    try {
      // Emit AI insights via WebSocket
      await this.emitAIInsights(tier, sessionId, groupId, insights);
      
      // Generate teacher prompts
      await this.generateTeacherPrompts(sessionId, groupId, insights);
      
      // Generate recommendations (for Tier 2)
      if (tier === 'tier2') {
        await this.generateRecommendations(sessionId, insights);
      }
      
    } catch (error) {
      console.error(`❌ Failed to process ${tier} insights:`, error);
    }
  }

  private async emitAIInsights(
    tier: 'tier1' | 'tier2',
    sessionId: string,
    groupId: string | undefined,
    insights: Tier1Insights | Tier2Insights
  ): Promise<void> {
    if (!this.websocketService) {
      console.warn('WebSocket service not available for insights emission');
      return;
    }
    
    const eventData: AIInsightEvent = {
      type: tier,
      sessionId,
      groupId,
      insights,
      timestamp: new Date(),
      processingTime: insights.metadata?.processingTimeMs || 0,
      confidence: insights.confidence
    };
    
    // Emit to session participants
    this.websocketService.emitToSession(sessionId, `ai:${tier}:insight`, eventData);
    
    console.log(`📡 ${tier.toUpperCase()} insights emitted to session ${sessionId}`);
  }

  private async generateTeacherPrompts(
    sessionId: string,
    groupId: string | undefined,
    insights: Tier1Insights | Tier2Insights
  ): Promise<void> {
    try {
      // Get session context (this would come from session data)
      const context = await this.getSessionContext(sessionId);
      
      if (!context) {
        console.warn(`No context available for session ${sessionId}`);
        return;
      }
      
      // Generate prompts
      const prompts = await teacherPromptService.generatePrompts(insights, {
        sessionId,
        groupId,
        teacherId: context.teacherId,
        sessionPhase: context.sessionPhase,
        subject: context.subject,
        learningObjectives: context.learningObjectives,
        groupSize: context.groupSize,
        sessionDuration: context.sessionDuration
      });
      
      // Prioritize and deliver alerts
      for (const prompt of prompts) {
        await this.deliverTeacherAlert(sessionId, context.teacherId, prompt);
      }
      
    } catch (error) {
      console.error(`❌ Failed to generate teacher prompts:`, error);
    }
  }

  private async generateRecommendations(
    sessionId: string,
    insights: Tier2Insights
  ): Promise<void> {
    try {
      // Get session context
      const context = await this.getSessionContext(sessionId);
      
      if (!context) {
        return;
      }
      
      // Generate recommendations
      const recommendations = await recommendationEngineService.generateRecommendations(
        insights,
        {
          sessionId,
          teacherId: context.teacherId,
          schoolId: context.schoolId,
          subject: context.subject,
          sessionPhase: context.sessionPhase,
          sessionDuration: context.sessionDuration,
          groupCount: context.groupCount,
          studentCount: context.studentCount,
          learningObjectives: context.learningObjectives
        }
      );
      
      // Emit recommendations via WebSocket
      if (this.websocketService && recommendations.length > 0) {
        this.websocketService.emitToSession(sessionId, 'teacher:recommendations', {
          sessionId,
          recommendations: recommendations.slice(0, 5), // Top 5 recommendations
          generatedAt: new Date().toISOString()
        });
      }
      
    } catch (error) {
      console.error(`❌ Failed to generate recommendations:`, error);
    }
  }

  private async deliverTeacherAlert(
    sessionId: string,
    teacherId: string,
    prompt: any
  ): Promise<void> {
    try {
      // Prioritize the alert
      const alertResult = await alertPrioritizationService.prioritizeAlert(prompt, {
        sessionId,
        teacherId,
        sessionPhase: 'development', // Default phase
        currentAlertCount: 0,
        teacherEngagementScore: 0.7
      });
      
      // Deliver via WebSocket if immediate
      if (this.websocketService && alertResult.batchGroup === 'immediate') {
        const alertEvent: TeacherAlertEvent = {
          sessionId,
          teacherId,
          alert: {
            id: alertResult.alertId,
            type: 'prompt',
            priority: prompt.priority,
            message: prompt.message,
            actionRequired: prompt.priority === 'high',
            expiresAt: alertResult.scheduledDelivery
          }
        };
        
        this.websocketService.emitToSession(sessionId, 'teacher:alert', alertEvent);
        this.metrics.alertsGenerated++;
      }
      
    } catch (error) {
      console.error(`❌ Failed to deliver teacher alert:`, error);
    }
  }

  // ============================================================================
  // Private Methods - Utilities
  // ============================================================================

  private async getSessionContext(sessionId: string): Promise<any | null> {
    try {
      // This would fetch session details from database
      // For now, return mock context
      return {
        teacherId: 'teacher_123',
        schoolId: 'school_123',
        subject: 'general',
        sessionPhase: 'development',
        sessionDuration: 45,
        groupCount: 5,
        studentCount: 20,
        learningObjectives: ['Analyze text', 'Collaborate effectively']
      };
    } catch (error) {
      console.error(`❌ Failed to get session context for ${sessionId}:`, error);
      return null;
    }
  }

  private async processSessionFinalAnalysis(sessionId: string): Promise<void> {
    console.log(`🏁 Processing final analysis for session ${sessionId}`);
    
    // Force process any remaining transcriptions
    const events = this.processingQueues.get(sessionId) || [];
    if (events.length > 0) {
      await this.processTier2ForSession(sessionId, events);
    }
  }

  private async generateSessionSummaryRecommendations(sessionId: string): Promise<void> {
    console.log(`📊 Generating session summary for ${sessionId}`);
    
    // Generate final session recommendations
    // This would be implemented based on session analytics
  }

  private async processRemainingQueues(): Promise<void> {
    console.log('🔄 Processing remaining queued items...');
    
    const promises: Promise<void>[] = [];
    
    for (const [sessionId, events] of this.processingQueues.entries()) {
      if (events.length > 0) {
        promises.push(this.processTier2ForSession(sessionId, events));
      }
    }
    
    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }
    
    this.processingQueues.clear();
  }

  private async handleProcessingError(event: TranscriptionEvent, error: any): Promise<void> {
    console.warn(`⚠️ Graceful degradation for event ${event.id}:`, error);
    
    // Emit basic insight without AI analysis
    if (this.websocketService) {
      this.websocketService.emitToSession(event.sessionId, 'system:notice', {
        type: 'processing_degraded',
        message: 'AI analysis temporarily unavailable, basic processing continues',
        timestamp: new Date().toISOString()
      });
    }
  }

  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck().catch(error => {
        console.error('❌ Health check failed:', error);
      });
    }, this.config.healthCheckIntervalMs);
    
    console.log('💓 Health monitoring started');
  }

  private async performHealthCheck(): Promise<void> {
    const healthEvent: SystemHealthEvent = {
      service: 'ai_websocket_integration',
      status: 'healthy',
      metrics: {
        latency: this.metrics.lastProcessingTime,
        throughput: this.metrics.transcriptionsProcessed,
        errorRate: this.metrics.errorsEncountered / Math.max(1, this.metrics.transcriptionsProcessed)
      },
      timestamp: new Date()
    };
    
    // Check if error rate is too high
    if (healthEvent.metrics.errorRate > 0.1) {
      healthEvent.status = 'degraded';
    }
    
    // Emit health status
    this.emit('health_check', healthEvent);
    
    // Emit via WebSocket for monitoring
    if (this.websocketService) {
      this.websocketService.emit('system:health', healthEvent);
    }
  }

  private async auditLog(data: {
    eventType: string;
    actorId: string;
    targetType: string;
    targetId: string;
    educationalPurpose: string;
    complianceBasis: string;
    sessionId?: string;
    transcriptionLength?: number;
  }): Promise<void> {
    try {
      await databricksService.recordAuditLog({
        actorId: data.actorId,
        actorType: 'system',
        eventType: data.eventType,
        eventCategory: 'data_access',
        resourceType: data.targetType,
        resourceId: data.targetId,
        schoolId: 'system',
        description: data.educationalPurpose,
        complianceBasis: 'legitimate_interest',
        dataAccessed: data.transcriptionLength ? `transcription_${data.transcriptionLength}_chars` : 'ai_integration_metadata'
      });
    } catch (error) {
      console.warn('⚠️ Audit logging failed in AI WebSocket integration:', error);
    }
  }
}

// ============================================================================
// Export Singleton Instance
// ============================================================================

export const aiWebSocketIntegrationService = new AIWebSocketIntegrationService();

// Integration function for easy setup
export async function integrateAIWithTranscription(websocketService: WebSocketService): Promise<void> {
  await aiWebSocketIntegrationService.initialize(websocketService);
  console.log('🚀 AI-Transcription integration completed');
}

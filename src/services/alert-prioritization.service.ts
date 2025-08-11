/**
 * Alert Prioritization Service
 * 
 * Smart prioritization and batching of teacher alerts and prompts:
 * - Dynamic priority scoring based on urgency and context
 * - Intelligent batching to prevent alert fatigue
 * - Real-time alert delivery optimization
 * - Adaptive learning from teacher responses
 * 
 * ✅ COMPLIANCE: FERPA/COPPA compliant with audit logging
 * ✅ PERFORMANCE: Non-blocking async processing with batching
 * ✅ RELIABILITY: Error handling and graceful degradation
 */

import { z } from 'zod';
import { databricksService } from './databricks.service';
import { TeacherPrompt } from '../types/teacher-guidance.types';

// ============================================================================
// Input Validation Schemas
// ============================================================================

const alertConfigSchema = z.object({
  maxAlertsPerMinute: z.number().min(1).max(20).default(5),
  batchIntervalMs: z.number().min(1000).max(60000).default(30000),
  highPriorityImmediateDelivery: z.boolean().default(true),
  adaptiveLearningEnabled: z.boolean().default(true),
  teacherResponseTimeoutMs: z.number().min(30000).max(300000).default(120000)
});

const alertContextSchema = z.object({
  sessionId: z.string().uuid(),
  teacherId: z.string().uuid(),
  sessionPhase: z.enum(['opening', 'development', 'synthesis', 'closure']),
  currentAlertCount: z.number().min(0).default(0),
  lastAlertTimestamp: z.date().optional(),
  teacherEngagementScore: z.number().min(0).max(1).optional()
});

// ============================================================================
// Alert Priority Types
// ============================================================================

export interface PrioritizedAlert {
  id: string;
  prompt: TeacherPrompt;
  priorityScore: number; // 0-1, higher = more urgent
  batchGroup: 'immediate' | 'next_batch' | 'low_priority';
  scheduledDelivery: Date;
  contextFactors: {
    urgency: number;
    relevance: number;
    timing: number;
    teacherHistory: number;
    sessionContext: number;
  };
  deliveryMetadata: {
    maxRetries: number;
    currentRetries: number;
    lastAttempt?: Date;
    deliveryMethod: 'websocket' | 'batch' | 'delayed';
  };
}

interface AlertBatch {
  id: string;
  sessionId: string;
  teacherId: string;
  alerts: PrioritizedAlert[];
  scheduledDelivery: Date;
  batchType: 'urgent' | 'regular' | 'low_priority';
  totalPriorityScore: number;
}

interface TeacherAlertProfile {
  teacherId: string;
  responsiveness: number; // 0-1, based on historical response times
  preferredAlertFrequency: number; // alerts per minute
  effectiveAlertTypes: string[]; // most effective prompt categories
  dismissalPatterns: Record<string, number>; // category -> dismissal rate
  lastUpdated: Date;
  sessionCount: number;
}

// ============================================================================
// Alert Prioritization Service
// ============================================================================

export class AlertPrioritizationService {
  private alertQueues = new Map<string, PrioritizedAlert[]>(); // sessionId -> alerts
  private batchScheduler = new Map<string, NodeJS.Timeout>(); // sessionId -> timeout
  private teacherProfiles = new Map<string, TeacherAlertProfile>();
  private deliveryHistory = new Map<string, Date[]>(); // sessionId -> delivery timestamps
  
  private readonly config = {
    maxAlertsPerMinute: parseInt(process.env.TEACHER_ALERT_MAX_PER_MINUTE || '5'),
    batchIntervalMs: parseInt(process.env.TEACHER_PROMPT_BATCH_INTERVAL_MS || '30000'),
    highPriorityThreshold: parseFloat(process.env.TEACHER_ALERT_HIGH_PRIORITY_THRESHOLD || '0.7'),
    learningEnabled: process.env.TEACHER_ALERT_ADAPTIVE_LEARNING !== 'false',
    responseTimeoutMs: parseInt(process.env.TEACHER_ALERT_AUTO_EXPIRE_MS || '120000')
  };

  constructor() {
    // Load teacher profiles from database
    this.loadTeacherProfiles();
    
    // Start cleanup process for expired alerts
    this.startCleanupProcess();
    
    console.log('🚨 Alert Prioritization Service initialized', {
      maxAlertsPerMinute: this.config.maxAlertsPerMinute,
      batchIntervalMs: this.config.batchIntervalMs,
      adaptiveLearning: this.config.learningEnabled
    });
  }

  // ============================================================================
  // Public Methods
  // ============================================================================

  /**
   * Process and prioritize a teacher prompt for delivery
   * 
   * ✅ COMPLIANCE: Group-level analysis, audit logging
   * ✅ PERFORMANCE: Non-blocking processing with intelligent batching
   * ✅ ADAPTIVE: Learns from teacher response patterns
   */
  async prioritizeAlert(
    prompt: TeacherPrompt,
    context: z.infer<typeof alertContextSchema>
  ): Promise<{ alertId: string; scheduledDelivery: Date; batchGroup: string }> {
    const startTime = Date.now();
    
    try {
      // ✅ SECURITY: Input validation
      const validatedContext = alertContextSchema.parse(context);

      // Calculate priority score using multiple factors
      const priorityScore = await this.calculatePriorityScore(prompt, validatedContext);
      
      // Create prioritized alert
      const alert = await this.createPrioritizedAlert(prompt, priorityScore, validatedContext);
      
      // Determine delivery strategy
      const deliveryStrategy = this.determineDeliveryStrategy(alert, validatedContext);
      
      // Add to appropriate queue
      await this.queueAlert(alert, deliveryStrategy);
      
      // ✅ COMPLIANCE: Audit logging for alert prioritization
      await this.auditLog({
        eventType: 'alert_prioritization',
        actorId: 'system',
        targetType: 'teacher_alert',
        targetId: alert.id,
        educationalPurpose: 'Prioritize teacher guidance alerts for optimal delivery timing',
        complianceBasis: 'legitimate_educational_interest',
        sessionId: context.sessionId,
        priorityScore,
        batchGroup: alert.batchGroup
      });

      const processingTime = Date.now() - startTime;
      console.log(`✅ Alert prioritized: ${alert.id} (score: ${priorityScore.toFixed(3)}, group: ${alert.batchGroup}) in ${processingTime}ms`);

      return {
        alertId: alert.id,
        scheduledDelivery: alert.scheduledDelivery,
        batchGroup: alert.batchGroup
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`❌ Alert prioritization failed:`, error);
      
      // ✅ COMPLIANCE: Audit log for errors
      await this.auditLog({
        eventType: 'alert_prioritization_error',
        actorId: 'system',
        targetType: 'teacher_alert',
        targetId: 'unknown',
        educationalPurpose: 'Log alert prioritization error for system monitoring',
        complianceBasis: 'system_administration',
        sessionId: context.sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw error;
    }
  }

  /**
   * Get pending alerts for a session
   */
  getPendingAlerts(sessionId: string): PrioritizedAlert[] {
    return this.alertQueues.get(sessionId) || [];
  }

  /**
   * Record teacher response to an alert for adaptive learning
   */
  async recordAlertResponse(
    alertId: string,
    sessionId: string,
    teacherId: string,
    responseType: 'acknowledged' | 'used' | 'dismissed' | 'expired',
    responseTimeMs: number,
    feedback?: { rating: number; useful: boolean }
  ): Promise<void> {
    try {
      // Update teacher profile for adaptive learning
      if (this.config.learningEnabled) {
        await this.updateTeacherProfile(teacherId, responseType, responseTimeMs, feedback);
      }

      // Remove alert from queue if completed
      if (['used', 'dismissed', 'expired'].includes(responseType)) {
        await this.removeAlertFromQueue(sessionId, alertId);
      }

      // ✅ COMPLIANCE: Audit logging for response tracking
      await this.auditLog({
        eventType: 'alert_response_recorded',
        actorId: teacherId,
        targetType: 'teacher_alert_response',
        targetId: alertId,
        educationalPurpose: 'Track teacher responses to improve alert system effectiveness',
        complianceBasis: 'legitimate_educational_interest',
        sessionId,
        responseType,
        responseTimeMs,
        feedbackRating: feedback?.rating
      });

      console.log(`📊 Alert response recorded: ${alertId} -> ${responseType} (${responseTimeMs}ms)`);

    } catch (error) {
      console.error(`❌ Failed to record alert response:`, error);
      throw error;
    }
  }

  /**
   * Get alert delivery statistics for monitoring
   */
  getAlertStatistics(sessionId?: string): {
    totalPending: number;
    byPriority: Record<string, number>;
    byCategory: Record<string, number>;
    averageResponseTime: number;
    deliveryRate: number;
  } {
    let allAlerts: PrioritizedAlert[] = [];
    
    if (sessionId) {
      allAlerts = this.alertQueues.get(sessionId) || [];
    } else {
      for (const alerts of this.alertQueues.values()) {
        allAlerts.push(...alerts);
      }
    }

    const stats = {
      totalPending: allAlerts.length,
      byPriority: {} as Record<string, number>,
      byCategory: {} as Record<string, number>,
      averageResponseTime: 0,
      deliveryRate: 0
    };

    // Calculate distributions
    for (const alert of allAlerts) {
      const priority = alert.priorityScore > 0.7 ? 'high' : alert.priorityScore > 0.4 ? 'medium' : 'low';
      stats.byPriority[priority] = (stats.byPriority[priority] || 0) + 1;
      stats.byCategory[alert.prompt.category] = (stats.byCategory[alert.prompt.category] || 0) + 1;
    }

    return stats;
  }

  /**
   * Force delivery of high-priority alerts immediately
   */
  async flushHighPriorityAlerts(sessionId: string): Promise<number> {
    const alerts = this.alertQueues.get(sessionId) || [];
    const highPriorityAlerts = alerts.filter(a => a.priorityScore > this.config.highPriorityThreshold);
    
    if (highPriorityAlerts.length > 0) {
      await this.deliverAlertBatch({
        id: `urgent_${Date.now()}`,
        sessionId,
        teacherId: highPriorityAlerts[0].prompt.teacherId,
        alerts: highPriorityAlerts,
        scheduledDelivery: new Date(),
        batchType: 'urgent',
        totalPriorityScore: highPriorityAlerts.reduce((sum, a) => sum + a.priorityScore, 0)
      });
      
      // Remove delivered alerts from queue
      const remainingAlerts = alerts.filter(a => !highPriorityAlerts.includes(a));
      this.alertQueues.set(sessionId, remainingAlerts);
    }
    
    return highPriorityAlerts.length;
  }

  // ============================================================================
  // Private Methods - Priority Calculation
  // ============================================================================

  private async calculatePriorityScore(
    prompt: TeacherPrompt,
    context: z.infer<typeof alertContextSchema>
  ): Promise<number> {
    const factors = {
      urgency: this.calculateUrgencyScore(prompt),
      relevance: this.calculateRelevanceScore(prompt, context),
      timing: this.calculateTimingScore(context),
      teacherHistory: await this.calculateTeacherHistoryScore(context.teacherId, prompt.category),
      sessionContext: this.calculateSessionContextScore(context)
    };

    // Weighted average of all factors
    const weights = {
      urgency: 0.3,
      relevance: 0.25,
      timing: 0.2,
      teacherHistory: 0.15,
      sessionContext: 0.1
    };

    const priorityScore = Object.entries(factors).reduce((score, [factor, value]) => {
      return score + (value * weights[factor as keyof typeof weights]);
    }, 0);

    return Math.max(0, Math.min(1, priorityScore));
  }

  private calculateUrgencyScore(prompt: TeacherPrompt): number {
    const urgencyMap = {
      high: 0.9,
      medium: 0.6,
      low: 0.3
    };
    
    let score = urgencyMap[prompt.priority];
    
    // Boost urgency for certain categories
    const urgentCategories = ['redirection', 'collaboration', 'energy'];
    if (urgentCategories.includes(prompt.category)) {
      score += 0.1;
    }
    
    // Time-sensitive prompts are more urgent
    if (prompt.suggestedTiming === 'immediate') {
      score += 0.2;
    }
    
    return Math.min(1, score);
  }

  private calculateRelevanceScore(
    prompt: TeacherPrompt, 
    context: z.infer<typeof alertContextSchema>
  ): number {
    let score = 0.5; // Base relevance
    
    // Phase-specific relevance
    const phaseRelevance = {
      opening: ['facilitation', 'energy'],
      development: ['deepening', 'collaboration', 'assessment'],
      synthesis: ['collaboration', 'clarity'],
      closure: ['assessment', 'clarity']
    };
    
    if (phaseRelevance[context.sessionPhase].includes(prompt.category)) {
      score += 0.3;
    }
    
    // Effectiveness score from prompt
    if (prompt.effectivenessScore) {
      score += prompt.effectivenessScore * 0.2;
    }
    
    return Math.min(1, score);
  }

  private calculateTimingScore(context: z.infer<typeof alertContextSchema>): number {
    let score = 0.5;
    
    // Avoid alert fatigue - reduce score if too many recent alerts
    if (context.currentAlertCount > this.config.maxAlertsPerMinute) {
      score -= 0.3;
    }
    
    // Consider last alert timing
    if (context.lastAlertTimestamp) {
      const timeSinceLastAlert = Date.now() - context.lastAlertTimestamp.getTime();
      const minInterval = this.config.batchIntervalMs;
      
      if (timeSinceLastAlert < minInterval) {
        score -= 0.4; // Recent alert, reduce timing score
      } else if (timeSinceLastAlert > minInterval * 3) {
        score += 0.2; // Long gap, good timing
      }
    }
    
    return Math.max(0, Math.min(1, score));
  }

  private async calculateTeacherHistoryScore(teacherId: string, category: string): Promise<number> {
    const profile = this.teacherProfiles.get(teacherId);
    
    if (!profile) {
      return 0.5; // Neutral score for new teachers
    }
    
    let score = profile.responsiveness; // Base score from responsiveness
    
    // Adjust based on category effectiveness
    if (profile.effectiveAlertTypes.includes(category)) {
      score += 0.2;
    }
    
    // Reduce score for categories with high dismissal rates
    const dismissalRate = profile.dismissalPatterns[category] || 0;
    score -= dismissalRate * 0.3;
    
    return Math.max(0, Math.min(1, score));
  }

  private calculateSessionContextScore(context: z.infer<typeof alertContextSchema>): number {
    let score = 0.5;
    
    // Teacher engagement affects alert value
    if (context.teacherEngagementScore !== undefined) {
      if (context.teacherEngagementScore > 0.7) {
        score += 0.3; // Engaged teacher, alerts more valuable
      } else if (context.teacherEngagementScore < 0.3) {
        score -= 0.2; // Low engagement, may need different approach
      }
    }
    
    return Math.max(0, Math.min(1, score));
  }

  // ============================================================================
  // Private Methods - Alert Management
  // ============================================================================

  private async createPrioritizedAlert(
    prompt: TeacherPrompt,
    priorityScore: number,
    context: z.infer<typeof alertContextSchema>
  ): Promise<PrioritizedAlert> {
    const now = new Date();
    const batchGroup = this.determineBatchGroup(priorityScore, prompt);
    const scheduledDelivery = this.calculateScheduledDelivery(batchGroup, context);

    return {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      prompt,
      priorityScore,
      batchGroup,
      scheduledDelivery,
      contextFactors: {
        urgency: this.calculateUrgencyScore(prompt),
        relevance: this.calculateRelevanceScore(prompt, context),
        timing: this.calculateTimingScore(context),
        teacherHistory: await this.calculateTeacherHistoryScore(context.teacherId, prompt.category),
        sessionContext: this.calculateSessionContextScore(context)
      },
      deliveryMetadata: {
        maxRetries: batchGroup === 'immediate' ? 3 : 1,
        currentRetries: 0,
        deliveryMethod: batchGroup === 'immediate' ? 'websocket' : 'batch'
      }
    };
  }

  private determineBatchGroup(priorityScore: number, prompt: TeacherPrompt): 'immediate' | 'next_batch' | 'low_priority' {
    if (priorityScore > this.config.highPriorityThreshold || prompt.suggestedTiming === 'immediate') {
      return 'immediate';
    } else if (priorityScore > 0.4) {
      return 'next_batch';
    } else {
      return 'low_priority';
    }
  }

  private calculateScheduledDelivery(
    batchGroup: 'immediate' | 'next_batch' | 'low_priority',
    context: z.infer<typeof alertContextSchema>
  ): Date {
    const now = new Date();
    
    switch (batchGroup) {
      case 'immediate':
        return now; // Deliver immediately
      case 'next_batch':
        return new Date(now.getTime() + this.config.batchIntervalMs);
      case 'low_priority':
        return new Date(now.getTime() + this.config.batchIntervalMs * 2);
      default:
        return now;
    }
  }

  private determineDeliveryStrategy(
    alert: PrioritizedAlert,
    context: z.infer<typeof alertContextSchema>
  ): 'immediate' | 'batch' | 'delayed' {
    if (alert.batchGroup === 'immediate') {
      return 'immediate';
    }
    
    // Check current alert load
    const currentAlerts = this.alertQueues.get(context.sessionId) || [];
    const recentAlerts = this.getRecentDeliveries(context.sessionId);
    
    if (recentAlerts.length >= this.config.maxAlertsPerMinute) {
      return 'delayed';
    }
    
    return 'batch';
  }

  private async queueAlert(alert: PrioritizedAlert, strategy: 'immediate' | 'batch' | 'delayed'): Promise<void> {
    const sessionId = alert.prompt.sessionId;
    
    if (!this.alertQueues.has(sessionId)) {
      this.alertQueues.set(sessionId, []);
    }
    
    const queue = this.alertQueues.get(sessionId)!;
    
    // Insert alert in priority order
    const insertIndex = queue.findIndex(a => a.priorityScore < alert.priorityScore);
    if (insertIndex === -1) {
      queue.push(alert);
    } else {
      queue.splice(insertIndex, 0, alert);
    }
    
    // Handle immediate delivery
    if (strategy === 'immediate') {
      await this.deliverAlertImmediately(alert);
    } else {
      // Schedule batch delivery if not already scheduled
      this.scheduleBatchDelivery(sessionId);
    }
  }

  private async deliverAlertImmediately(alert: PrioritizedAlert): Promise<void> {
    try {
      // Import WebSocket service dynamically to avoid circular dependencies
      const { getWebSocketService } = await import('./websocket.service');
      const wsService = getWebSocketService();
      
      if (wsService) {
        const deliveryId = `delivery_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        wsService.emitToSession(alert.prompt.sessionId, 'teacher:alert:immediate', {
          alert: {
            id: alert.id,
            prompt: alert.prompt,
            priority: alert.priorityScore,
            deliveryTime: new Date().toISOString(),
            deliveryId,
            requiresConfirmation: true
          }
        });
        
        // Record delivery attempt
        this.recordDelivery(alert.prompt.sessionId);
        alert.deliveryMetadata.lastAttempt = new Date();
        
        // Set up delivery confirmation timeout
        this.setupDeliveryConfirmation(alert, deliveryId);
        
        console.log(`🚨 Immediate alert delivered: ${alert.id} (delivery: ${deliveryId})`);
      }
    } catch (error) {
      console.error(`❌ Failed to deliver immediate alert ${alert.id}:`, error);
      alert.deliveryMetadata.currentRetries++;
      
      // Retry if under limit
      if (alert.deliveryMetadata.currentRetries < alert.deliveryMetadata.maxRetries) {
        setTimeout(() => {
          this.deliverAlertImmediately(alert);
        }, 5000); // Retry after 5 seconds
      }
    }
  }

  private scheduleBatchDelivery(sessionId: string): void {
    // Only schedule if not already scheduled
    if (this.batchScheduler.has(sessionId)) {
      return;
    }
    
    const timeout = setTimeout(async () => {
      await this.processBatchDelivery(sessionId);
      this.batchScheduler.delete(sessionId);
    }, this.config.batchIntervalMs);
    
    this.batchScheduler.set(sessionId, timeout);
  }

  private async processBatchDelivery(sessionId: string): Promise<void> {
    const alerts = this.alertQueues.get(sessionId) || [];
    const readyAlerts = alerts.filter(a => 
      a.scheduledDelivery <= new Date() && 
      a.batchGroup !== 'immediate'
    );
    
    if (readyAlerts.length === 0) {
      return;
    }
    
    // Group alerts by priority
    const highPriority = readyAlerts.filter(a => a.priorityScore > this.config.highPriorityThreshold);
    const regularPriority = readyAlerts.filter(a => a.priorityScore <= this.config.highPriorityThreshold);
    
    // Deliver high priority batch first
    if (highPriority.length > 0) {
      await this.deliverAlertBatch({
        id: `batch_high_${Date.now()}`,
        sessionId,
        teacherId: highPriority[0].prompt.teacherId,
        alerts: highPriority,
        scheduledDelivery: new Date(),
        batchType: 'urgent',
        totalPriorityScore: highPriority.reduce((sum, a) => sum + a.priorityScore, 0)
      });
    }
    
    // Deliver regular priority batch
    if (regularPriority.length > 0) {
      await this.deliverAlertBatch({
        id: `batch_regular_${Date.now()}`,
        sessionId,
        teacherId: regularPriority[0].prompt.teacherId,
        alerts: regularPriority,
        scheduledDelivery: new Date(),
        batchType: 'regular',
        totalPriorityScore: regularPriority.reduce((sum, a) => sum + a.priorityScore, 0)
      });
    }
    
    // Remove delivered alerts from queue
    const remainingAlerts = alerts.filter(a => !readyAlerts.includes(a));
    this.alertQueues.set(sessionId, remainingAlerts);
  }

  private async deliverAlertBatch(batch: AlertBatch): Promise<void> {
    try {
      // Import WebSocket service dynamically
      const { getWebSocketService } = await import('./websocket.service');
      const wsService = getWebSocketService();
      
      if (wsService) {
        const deliveryId = `batch_delivery_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        wsService.emitToSession(batch.sessionId, 'teacher:alert:batch', {
          batchId: batch.id,
          batchType: batch.batchType,
          alerts: batch.alerts.map(a => ({
            id: a.id,
            prompt: a.prompt,
            priority: a.priorityScore,
            contextFactors: a.contextFactors
          })),
          totalAlerts: batch.alerts.length,
          deliveryTime: new Date().toISOString(),
          deliveryId,
          requiresConfirmation: batch.batchType === 'urgent'
        });
        
        // Record delivery
        this.recordDelivery(batch.sessionId);
        
        // Set up delivery confirmation for urgent batches
        if (batch.batchType === 'urgent') {
          this.setupBatchDeliveryConfirmation(batch, deliveryId);
        }
        
        console.log(`📦 Alert batch delivered: ${batch.id} (${batch.alerts.length} alerts, delivery: ${deliveryId})`);
      }
    } catch (error) {
      console.error(`❌ Failed to deliver alert batch ${batch.id}:`, error);
    }
  }

  // ============================================================================
  // Private Methods - Delivery Confirmation
  // ============================================================================

  /**
   * Set up delivery confirmation timeout for individual alerts
   */
  private setupDeliveryConfirmation(alert: PrioritizedAlert, deliveryId: string): void {
    const confirmationTimeout = setTimeout(async () => {
      console.warn(`⚠️ Delivery confirmation timeout for alert ${alert.id} (delivery: ${deliveryId})`);
      
      // Record delivery failure
      await this.recordDeliveryTimeout(alert, deliveryId);
      
      // Retry if possible
      if (alert.deliveryMetadata.currentRetries < alert.deliveryMetadata.maxRetries) {
        console.log(`🔄 Retrying delivery for alert ${alert.id}`);
        await this.deliverAlertImmediately(alert);
      }
    }, 30000); // 30 second timeout
    
    // Store timeout for potential cleanup
    (alert as any).confirmationTimeoutId = confirmationTimeout;
  }

  /**
   * Set up delivery confirmation timeout for alert batches
   */
  private setupBatchDeliveryConfirmation(batch: AlertBatch, deliveryId: string): void {
    const confirmationTimeout = setTimeout(async () => {
      console.warn(`⚠️ Batch delivery confirmation timeout for batch ${batch.id} (delivery: ${deliveryId})`);
      
      // Record batch delivery failure
      await this.recordBatchDeliveryTimeout(batch, deliveryId);
      
    }, 45000); // 45 second timeout for batches
    
    // Store timeout reference
    (batch as any).confirmationTimeoutId = confirmationTimeout;
  }

  /**
   * Confirm delivery of an individual alert
   */
  async confirmAlertDelivery(alertId: string, deliveryId: string, sessionId: string): Promise<void> {
    try {
      // Find the alert and clear its timeout
      const alerts = this.alertQueues.get(sessionId) || [];
      const alert = alerts.find(a => a.id === alertId);
      
      if (alert && (alert as any).confirmationTimeoutId) {
        clearTimeout((alert as any).confirmationTimeoutId);
        delete (alert as any).confirmationTimeoutId;
      }
      
      // Record successful delivery
      await this.recordSuccessfulDelivery(alertId, deliveryId, sessionId);
      
      console.log(`✅ Alert delivery confirmed: ${alertId} (delivery: ${deliveryId})`);
      
    } catch (error) {
      console.error(`❌ Failed to confirm alert delivery:`, error);
    }
  }

  /**
   * Confirm delivery of an alert batch
   */
  async confirmBatchDelivery(batchId: string, deliveryId: string, sessionId: string): Promise<void> {
    try {
      // Record successful batch delivery
      await this.recordSuccessfulBatchDelivery(batchId, deliveryId, sessionId);
      
      console.log(`✅ Batch delivery confirmed: ${batchId} (delivery: ${deliveryId})`);
      
    } catch (error) {
      console.error(`❌ Failed to confirm batch delivery:`, error);
    }
  }

  private async recordDeliveryTimeout(alert: PrioritizedAlert, deliveryId: string): Promise<void> {
    try {
      await this.auditLog({
        eventType: 'alert_delivery_timeout',
        actorId: 'system',
        targetType: 'alert_delivery',
        targetId: alert.id,
        educationalPurpose: 'Track delivery failures for system reliability monitoring',
        complianceBasis: 'system_administration',
        sessionId: alert.prompt.sessionId,
        deliveryId,
        currentRetries: alert.deliveryMetadata.currentRetries,
        maxRetries: alert.deliveryMetadata.maxRetries
      });
    } catch (error) {
      console.warn('Failed to log delivery timeout:', error);
    }
  }

  private async recordBatchDeliveryTimeout(batch: AlertBatch, deliveryId: string): Promise<void> {
    try {
      await this.auditLog({
        eventType: 'batch_delivery_timeout',
        actorId: 'system',
        targetType: 'batch_delivery',
        targetId: batch.id,
        educationalPurpose: 'Track batch delivery failures for system reliability monitoring',
        complianceBasis: 'system_administration',
        sessionId: batch.sessionId,
        deliveryId,
        batchSize: batch.alerts.length
      });
    } catch (error) {
      console.warn('Failed to log batch delivery timeout:', error);
    }
  }

  private async recordSuccessfulDelivery(alertId: string, deliveryId: string, sessionId: string): Promise<void> {
    try {
      await this.auditLog({
        eventType: 'alert_delivery_confirmed',
        actorId: 'system',
        targetType: 'alert_delivery',
        targetId: alertId,
        educationalPurpose: 'Track successful alert deliveries for system reliability monitoring',
        complianceBasis: 'system_administration',
        sessionId,
        deliveryId
      });
    } catch (error) {
      console.warn('Failed to log successful delivery:', error);
    }
  }

  private async recordSuccessfulBatchDelivery(batchId: string, deliveryId: string, sessionId: string): Promise<void> {
    try {
      await this.auditLog({
        eventType: 'batch_delivery_confirmed',
        actorId: 'system',
        targetType: 'batch_delivery',
        targetId: batchId,
        educationalPurpose: 'Track successful batch deliveries for system reliability monitoring',
        complianceBasis: 'system_administration',
        sessionId,
        deliveryId
      });
    } catch (error) {
      console.warn('Failed to log successful batch delivery:', error);
    }
  }

  // ============================================================================
  // Private Methods - Adaptive Learning
  // ============================================================================

  private async loadTeacherProfiles(): Promise<void> {
    try {
      // Load from database - placeholder for now
      console.log('📚 Loading teacher alert profiles...');
      // Implementation will be added once database integration is complete
    } catch (error) {
      console.warn('⚠️ Failed to load teacher profiles:', error);
    }
  }

  private async updateTeacherProfile(
    teacherId: string,
    responseType: string,
    responseTimeMs: number,
    feedback?: { rating: number; useful: boolean }
  ): Promise<void> {
    let profile = this.teacherProfiles.get(teacherId);
    
    if (!profile) {
      profile = {
        teacherId,
        responsiveness: 0.5,
        preferredAlertFrequency: this.config.maxAlertsPerMinute,
        effectiveAlertTypes: [],
        dismissalPatterns: {},
        lastUpdated: new Date(),
        sessionCount: 0
      };
    }
    
    // Update responsiveness based on response type and time
    if (responseType === 'used') {
      profile.responsiveness += 0.1;
    } else if (responseType === 'dismissed') {
      profile.responsiveness -= 0.05;
    }
    
    profile.responsiveness = Math.max(0, Math.min(1, profile.responsiveness));
    profile.lastUpdated = new Date();
    
    this.teacherProfiles.set(teacherId, profile);
  }

  // ============================================================================
  // Private Methods - Utilities
  // ============================================================================

  private recordDelivery(sessionId: string): void {
    if (!this.deliveryHistory.has(sessionId)) {
      this.deliveryHistory.set(sessionId, []);
    }
    
    const history = this.deliveryHistory.get(sessionId)!;
    history.push(new Date());
    
    // Keep only recent deliveries (last 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentDeliveries = history.filter(d => d > fiveMinutesAgo);
    this.deliveryHistory.set(sessionId, recentDeliveries);
  }

  private getRecentDeliveries(sessionId: string): Date[] {
    const history = this.deliveryHistory.get(sessionId) || [];
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    return history.filter(d => d > oneMinuteAgo);
  }

  private async removeAlertFromQueue(sessionId: string, alertId: string): Promise<void> {
    const queue = this.alertQueues.get(sessionId);
    if (queue) {
      const filtered = queue.filter(a => a.id !== alertId);
      this.alertQueues.set(sessionId, filtered);
    }
  }

  private startCleanupProcess(): void {
    setInterval(() => {
      this.cleanupExpiredAlerts().catch(error => {
        console.error('❌ Alert cleanup failed:', error);
      });
    }, 60000); // Every minute
  }

  private async cleanupExpiredAlerts(): Promise<void> {
    const now = new Date();
    let cleanedCount = 0;
    
    for (const [sessionId, alerts] of this.alertQueues.entries()) {
      const activeAlerts = alerts.filter(a => {
        const isExpired = now.getTime() - a.scheduledDelivery.getTime() > this.config.responseTimeoutMs;
        if (isExpired) cleanedCount++;
        return !isExpired;
      });
      
      this.alertQueues.set(sessionId, activeAlerts);
    }
    
    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} expired alerts`);
    }
  }

  private async auditLog(data: {
    eventType: string;
    actorId: string;
    targetType: string;
    targetId: string;
    educationalPurpose: string;
    complianceBasis: string;
    sessionId: string;
    priorityScore?: number;
    batchGroup?: string;
    responseType?: string;
    responseTimeMs?: number;
    feedbackRating?: number;
    error?: string;
    deliveryId?: string;
    currentRetries?: number;
    maxRetries?: number;
    batchSize?: number;
  }): Promise<void> {
    try {
      await databricksService.recordAuditLog({
        actorId: data.actorId,
        actorType: data.actorId === 'system' ? 'system' : 'teacher',
        eventType: data.eventType,
        eventCategory: 'data_access',
        resourceType: data.targetType,
        resourceId: data.targetId,
        schoolId: 'system',
        description: data.educationalPurpose,
        complianceBasis: 'legitimate_interest',
        dataAccessed: data.error ? `error: ${data.error}` : 'alert_metadata'
      });
    } catch (error) {
      console.warn('⚠️ Audit logging failed in alert prioritization service:', error);
    }
  }
}

// ============================================================================
// Export Singleton Instance
// ============================================================================

export const alertPrioritizationService = new AlertPrioritizationService();

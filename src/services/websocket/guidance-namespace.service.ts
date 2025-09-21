import { Socket } from 'socket.io';
import { NamespaceBaseService, NamespaceSocketData } from './namespace-base.service';
import { databricksService } from '../databricks.service';
import { redisService } from '../redis.service';
import { teacherPromptService } from '../teacher-prompt.service';
import { aiAnalysisBufferService } from '../ai-analysis-buffer.service';
import { alertPrioritizationService } from '../alert-prioritization.service';
import * as client from 'prom-client';
import type { WsGuidanceAnalyticsEvent } from '@classwaves/shared';
import { logger } from '../../utils/logger';
import {
  getGuidancePromptActionCounter,
  getGuidanceRedisUnavailableCounter,
  getGuidanceTimeToFirstActionHistogram,
  getGuidanceWsSubscribersGauge,
} from '../../metrics/guidance.metrics';

interface GuidanceSocketData extends NamespaceSocketData {
  subscribedSessions: Set<string>;
  subscriptions: Set<string>;
  analyticsSubscriptions: Map<string, Set<string>>;
}

interface SubscriptionData {
  sessionId?: string;
  subscriptions?: string[];
}

type PromptInteractionAction =
  | 'ack'
  | 'acknowledge'
  | 'use'
  | 'dismiss'
  | 'snooze'
  | 'copy'
  | 'save_exit_check';

type GuidanceRedisComponent = 'attention_gate' | 'autoprompt' | 'prompt_timing' | 'ontrack_summary';

interface PromptInteractionData {
  promptId: string;
  action: PromptInteractionAction;
  feedback?: string;
  sessionId?: string;
  userId?: string;
  timestamp?: number | string;
}

export class GuidanceNamespaceService extends NamespaceBaseService {
  protected getNamespaceName(): string {
    return '/guidance';
  }

  // Observability counters
  private static tier1Emits = (() => {
    try {
      return new client.Counter({ name: 'guidance_tier1_insight_emits_total', help: 'Tier1 insight emits', labelNames: ['namespace'] });
    } catch {
      return client.register.getSingleMetric('guidance_tier1_insight_emits_total') as client.Counter<string>;
    }
  })();
  private static tier2Emits = (() => {
    try {
      return new client.Counter({ name: 'guidance_tier2_insight_emits_total', help: 'Tier2 insight emits', labelNames: ['namespace'] });
    } catch {
      return client.register.getSingleMetric('guidance_tier2_insight_emits_total') as client.Counter<string>;
    }
  })();
  private static tier1DeliveredBySchool = (() => {
    try {
      return new client.Counter({ name: 'guidance_tier1_insight_delivered_total', help: 'Tier1 insights delivered (by school)', labelNames: ['school'] });
    } catch {
      return client.register.getSingleMetric('guidance_tier1_insight_delivered_total') as client.Counter<string>;
    }
  })();
  private static tier2DeliveredBySchool = (() => {
    try {
      return new client.Counter({ name: 'guidance_tier2_insight_delivered_total', help: 'Tier2 insights delivered (by school)', labelNames: ['school'] });
    } catch {
      return client.register.getSingleMetric('guidance_tier2_insight_delivered_total') as client.Counter<string>;
    }
  })();
  private static teacherRecsEmits = (() => {
    try {
      return new client.Counter({ name: 'guidance_teacher_recommendations_emits_total', help: 'Teacher recommendations emits', labelNames: ['namespace'] });
    } catch {
      return client.register.getSingleMetric('guidance_teacher_recommendations_emits_total') as client.Counter<string>;
    }
  })();
  private static promptDeliveryLatency = (() => {
    try {
      return new client.Histogram({
        name: 'guidance_prompt_delivery_latency_ms',
        help: 'Latency from prompt generation to emit to guidance',
        buckets: [50, 100, 200, 500, 1000, 2000, 5000, 10000],
        labelNames: ['tier']
      });
    } catch {
      return client.register.getSingleMetric('guidance_prompt_delivery_latency_ms') as client.Histogram<string>;
    }
  })();
  private static promptDeliveryTotal = (() => {
    try {
      return new client.Counter({
        name: 'guidance_prompt_delivery_total',
        help: 'Prompt delivery attempts (delivered vs no_subscriber)',
        labelNames: ['tier', 'status', 'school']
      });
    } catch {
      return client.register.getSingleMetric('guidance_prompt_delivery_total') as client.Counter<string>;
    }
  })();
  private static teacherAlertsEmits = (() => {
    try {
      return new client.Counter({ name: 'guidance_teacher_alerts_emits_total', help: 'Teacher alerts emits', labelNames: ['namespace'] });
    } catch {
      return client.register.getSingleMetric('guidance_teacher_alerts_emits_total') as client.Counter<string>;
    }
  })();
  private static emitsFailed = (() => {
    try {
      return new client.Counter({ name: 'guidance_emits_failed_total', help: 'Guidance emits that failed to reach any subscriber', labelNames: ['namespace', 'type'] });
    } catch {
      return client.register.getSingleMetric('guidance_emits_failed_total') as client.Counter<string>;
    }
  })();
  private static promptActionCounter = getGuidancePromptActionCounter();
  private static promptFirstActionHistogram = getGuidanceTimeToFirstActionHistogram();
  private static redisUnavailableCounter = getGuidanceRedisUnavailableCounter();
  private static wsSubscribersGauge = getGuidanceWsSubscribersGauge();

  private readonly sessionSubscriberCounts = new Map<string, number>();
  private readonly redisErrorLogTimestamps = new Map<GuidanceRedisComponent, number>();

  protected onConnection(socket: Socket): void {
    const socketData = socket.data as GuidanceSocketData;
    socketData.subscribedSessions = new Set();
    socketData.subscriptions = new Set();
    socketData.analyticsSubscriptions = new Map();

    // Only allow teachers and super_admin in guidance namespace
    if (socket.data.role !== 'teacher' && socket.data.role !== 'super_admin') {
      socket.emit('error', {
        code: 'ACCESS_DENIED',
        message: 'Teacher guidance is only available to teachers and administrators'
      });
      socket.disconnect();
      return;
    }

    // Teacher guidance subscription events
    socket.on('guidance:subscribe', async (data: SubscriptionData) => {
      await this.handleGuidanceSubscription(socket, data);
    });

    socket.on('guidance:unsubscribe', async (data: SubscriptionData) => {
      await this.handleGuidanceUnsubscription(socket, data);
    });

    // Prompt interaction events
    const promptInteractionListener = async (data: PromptInteractionData) => {
      await this.handlePromptInteraction(socket, data);
    };
    socket.on('prompt:interaction', promptInteractionListener);
    socket.on('teacher:prompt:interaction', promptInteractionListener);

    // Session-specific subscriptions
    socket.on('session:guidance:subscribe', async (data: { sessionId: string }) => {
      await this.handleSessionGuidanceSubscription(socket, data);
    });

    socket.on('session:guidance:unsubscribe', async (data: { sessionId: string }) => {
      await this.handleSessionGuidanceUnsubscription(socket, data);
    });

    // Request current insights/prompts
    socket.on('guidance:get_current_state', async (data: { sessionId?: string }) => {
      await this.handleGetCurrentState(socket, data);
    });

    // Analytics subscription
    socket.on('analytics:subscribe', async (data: { sessionId?: string; metrics?: string[] }) => {
      await this.handleAnalyticsSubscription(socket, data);
    });

    socket.on('analytics:unsubscribe', async (data: { sessionId?: string; metrics?: string[] }) => {
      await this.handleAnalyticsUnsubscription(socket, data);
    });

    logger.debug(`Guidance namespace: Teacher ${socket.data.userId} connected for guidance`);
  }

  protected onDisconnection(socket: Socket, reason: string): void {
    const socketData = socket.data as GuidanceSocketData;
    
    // Clean up subscriptions
    if (socketData.subscribedSessions) {
      socketData.subscribedSessions.forEach(sessionId => {
        this.notifySessionOfSubscriberChange(sessionId, socket.data.userId, 'unsubscribed');
        this.adjustSessionSubscriberGauge(sessionId, -1);
      });
      socketData.subscribedSessions.clear();
    }
  }

  protected onUserFullyDisconnected(userId: string): void {
    // Update guidance system that teacher is offline
    logger.debug(`Guidance namespace: Teacher ${userId} fully disconnected from guidance`);
  }

  protected onError(socket: Socket, error: Error): void {
    socket.emit('error', {
      code: 'GUIDANCE_ERROR',
      message: 'An error occurred in guidance namespace',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }

  // Subscription Handlers
  private async handleGuidanceSubscription(socket: Socket, data: SubscriptionData) {
    try {
      const socketData = socket.data as GuidanceSocketData;
      
      // Subscribe to general guidance events
      const subscriptions = data.subscriptions || ['teacher_alerts', 'recommendations', 'insights'];
      
      subscriptions.forEach(sub => {
        socketData.subscriptions.add(sub);
      });

      // Join general guidance room
      await socket.join('guidance:all');

      socket.emit('guidance:subscribed', {
        subscriptions: Array.from(socketData.subscriptions),
        timestamp: new Date()
      });

      logger.debug(`Guidance namespace: Teacher ${socket.data.userId} subscribed to guidance`);
    } catch (error) {
      logger.error('Guidance subscription error:', error);
      socket.emit('error', {
        code: 'SUBSCRIPTION_FAILED',
        message: 'Failed to subscribe to guidance'
      });
    }
  }

  private async handleGuidanceUnsubscription(socket: Socket, data: SubscriptionData) {
    try {
      const socketData = socket.data as GuidanceSocketData;
      
      if (data.subscriptions) {
        data.subscriptions.forEach(sub => {
          socketData.subscriptions.delete(sub);
        });
      } else {
        // Unsubscribe from all
        socketData.subscriptions.clear();
      }

      await socket.leave('guidance:all');

      socket.emit('guidance:unsubscribed', {
        remaining: Array.from(socketData.subscriptions),
        timestamp: new Date()
      });
    } catch (error) {
      logger.error('Guidance unsubscription error:', error);
      socket.emit('error', {
        code: 'UNSUBSCRIPTION_FAILED',
        message: 'Failed to unsubscribe from guidance'
      });
    }
  }

  private async handleSessionGuidanceSubscription(socket: Socket, data: { sessionId: string }) {
    try {
      // Verify teacher owns this session (repository preferred)
      let session: any = null;
      try {
        const { getCompositionRoot } = await import('../../app/composition-root');
        const repo = getCompositionRoot().getSessionRepository();
        session = await repo.getOwnedSessionBasic(data.sessionId, socket.data.userId);
      } catch { /* intentionally ignored: best effort cleanup */ }
      if (!session) {
        session = await databricksService.queryOne(
          `SELECT id, status FROM classwaves.sessions.classroom_sessions 
           WHERE id = ? AND teacher_id = ?`,
          [data.sessionId, socket.data.userId]
        );
      }

      if (!session) {
        socket.emit('error', {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found or not owned by user'
        });
        return;
      }

      const socketData = socket.data as GuidanceSocketData;
      const wasSubscribed = socketData.subscribedSessions.has(data.sessionId);
      socketData.subscribedSessions.add(data.sessionId);

      // Join session-specific guidance room
      const roomName = `guidance:session:${data.sessionId}`;
      await socket.join(roomName);

      // Notify that teacher is monitoring this session
      this.notifySessionOfSubscriberChange(data.sessionId, socket.data.userId, 'subscribed');

      if (!wasSubscribed) {
        this.adjustSessionSubscriberGauge(data.sessionId, 1);
      }

      socket.emit('session:guidance:subscribed', {
        sessionId: data.sessionId,
        sessionStatus: session.status,
        timestamp: new Date()
      });

      logger.debug(`Guidance namespace: Teacher ${socket.data.userId} subscribed to session ${data.sessionId} guidance`);
    } catch (error) {
      logger.error('Session guidance subscription error:', error);
      socket.emit('error', {
        code: 'SESSION_SUBSCRIPTION_FAILED',
        message: 'Failed to subscribe to session guidance'
      });
    }
  }

  private async handleSessionGuidanceUnsubscription(socket: Socket, data: { sessionId: string }) {
    try {
      const socketData = socket.data as GuidanceSocketData;
      const wasSubscribed = socketData.subscribedSessions.delete(data.sessionId);

      const roomName = `guidance:session:${data.sessionId}`;
      await socket.leave(roomName);

      this.notifySessionOfSubscriberChange(data.sessionId, socket.data.userId, 'unsubscribed');

      if (wasSubscribed) {
        this.adjustSessionSubscriberGauge(data.sessionId, -1);
      }

      socket.emit('session:guidance:unsubscribed', {
        sessionId: data.sessionId,
        timestamp: new Date()
      });
    } catch (error) {
      logger.error('Session guidance unsubscription error:', error);
      socket.emit('error', {
        code: 'SESSION_UNSUBSCRIPTION_FAILED',
        message: 'Failed to unsubscribe from session guidance'
      });
    }
  }

  // Prompt Interaction Handlers
  private async handlePromptInteraction(socket: Socket, data: PromptInteractionData) {
    try {
      // Verify prompt exists and teacher owns the session
      const prompt = await databricksService.queryOne(
        `SELECT id, session_id FROM classwaves.ai_insights.teacher_guidance_metrics WHERE id = ?`,
        [data.promptId]
      );

      if (!prompt || !prompt.session_id) {
        socket.emit('error', {
          code: 'PROMPT_NOT_FOUND',
          message: 'Prompt not found or access denied'
        });
        return;
      }

      // Ownership via SessionRepository
      let owns = false;
      try {
        const { getCompositionRoot } = await import('../../app/composition-root');
        const repo = getCompositionRoot().getSessionRepository();
        const session = await repo.getOwnedSessionBasic(prompt.session_id, socket.data.userId);
        owns = !!session;
      } catch { /* intentionally ignored: best effort cleanup */ }
      if (!owns) {
        socket.emit('error', {
          code: 'PROMPT_NOT_FOUND',
          message: 'Prompt not found or access denied'
        });
        return;
      }

      const { canonicalAction, metricsLabel } = this.normalizePromptInteractionAction(data.action);
      try { GuidanceNamespaceService.promptActionCounter.inc({ action: metricsLabel }); } catch { /* intentionally ignored: best effort cleanup */ }

      const shouldMeasureLatency = canonicalAction !== undefined && metricsLabel !== 'other';
      if (shouldMeasureLatency) {
        await this.observePromptActionLatency(data.promptId);
      }

      if (!canonicalAction) {
        logger.warn(`Unknown prompt interaction action received: ${data.action}`);
        socket.emit('prompt:interaction_confirmed', {
          promptId: data.promptId,
          action: data.action,
          timestamp: Date.now()
        });
        return;
      }

      const normalizedPayload: PromptInteractionData = {
        ...data,
        action: canonicalAction,
        sessionId: data.sessionId ?? prompt.session_id,
      };

      // Process the interaction
      await this.processPromptInteraction(normalizedPayload, socket.data.userId);

      // Broadcast interaction to session guidance subscribers
      if (prompt.session_id) {
        this.emitToRoom(`guidance:session:${prompt.session_id}`, 'prompt:interaction', {
          promptId: data.promptId,
          action: normalizedPayload.action,
          userId: socket.data.userId,
          feedback: data.feedback,
          sessionId: normalizedPayload.sessionId,
          timestamp: new Date().toISOString(),
          traceId: (socket.data as any)?.traceId || undefined,
        });
      }

      socket.emit('prompt:interaction_confirmed', {
        promptId: data.promptId,
        action: normalizedPayload.action,
        timestamp: Date.now()
      });

      logger.debug(`Guidance namespace: Teacher ${socket.data.userId} ${normalizedPayload.action} prompt ${data.promptId}`);
    } catch (error) {
      logger.error('Prompt interaction error:', error);
      socket.emit('error', {
        code: 'PROMPT_INTERACTION_FAILED',
        message: 'Failed to process prompt interaction'
      });
    }
  }

  private async handleGetCurrentState(socket: Socket, data: { sessionId?: string }) {
    try {
      let prompts: any[] = [];
      let insights: any = {};

      if (data.sessionId) {
        // Get session-specific state using implemented methods
        try {
          prompts = await teacherPromptService.getActivePrompts(data.sessionId, {
            priorityFilter: ['high', 'medium'], // Focus on actionable prompts
            maxAge: 30 // Last 30 minutes
          });
        } catch (error) {
          logger.warn(`⚠️ Failed to get active prompts for session ${data.sessionId}:`, error);
          prompts = []; // Graceful degradation
        }

        try {
          insights = await aiAnalysisBufferService.getCurrentInsights(data.sessionId, {
            maxAge: 10, // Last 10 minutes for real-time relevance
            includeMetadata: true
          });
        } catch (error) {
          logger.warn(`⚠️ Failed to get current insights for session ${data.sessionId}:`, error);
          insights = {}; // Graceful degradation
        }
      } else {
        // Get all active prompts for this teacher using repository-owned sessions
        try {
          const { getCompositionRoot } = await import('../../app/composition-root');
          const repo = getCompositionRoot().getSessionRepository();
          const sessionIds = await repo.listOwnedSessionIds(socket.data.userId);
          if (Array.isArray(sessionIds) && sessionIds.length > 0) {
            const placeholders = sessionIds.map(() => '?').join(', ');
            const sql = `
              SELECT 
                p.id,
                p.session_id,
                p.group_id,
                p.prompt_message,
                p.priority_level,
                p.generated_at,
                p.expires_at
              FROM classwaves.ai_insights.teacher_guidance_metrics p
              WHERE p.session_id IN (${placeholders})
                AND p.dismissed_at IS NULL
                AND (p.expires_at IS NULL OR p.expires_at > CURRENT_TIMESTAMP)
              ORDER BY p.priority_level DESC, p.generated_at DESC`;
            prompts = await databricksService.query(sql, sessionIds as any[]);
          } else {
            prompts = [];
          }
        } catch (e) {
          // Fallback to existing join if repository approach fails
          prompts = await databricksService.query(
            `SELECT 
               p.id,
               p.session_id,
               p.group_id,
               p.prompt_message,
               p.priority_level,
               p.generated_at,
               p.expires_at
             FROM classwaves.ai_insights.teacher_guidance_metrics p
             JOIN classwaves.sessions.classroom_sessions s ON p.session_id = s.id
             WHERE s.teacher_id = ?
               AND p.dismissed_at IS NULL
               AND (p.expires_at IS NULL OR p.expires_at > CURRENT_TIMESTAMP)
             ORDER BY p.priority_level DESC, p.generated_at DESC`,
            [socket.data.userId]
          );
        }
      }

      // Refactored current_state payload: expose tier1 and tier2ByGroup at top-level
      const tier1 = Array.isArray((insights as any)?.tier1Insights) ? (insights as any).tier1Insights : undefined;
      const tier2ByGroup = (insights as any)?.tier2ByGroup || undefined;
      const serializedPrompts = prompts.map((prompt) => {
        if (prompt && typeof prompt === 'object' && 'contextEvidence' in prompt) {
          const { contextEvidence, context, ...rest } = prompt as any;
          const paragraph = contextEvidence?.contextSummary ?? context ?? null;
          return {
            ...rest,
            contextSummary: paragraph,
            context: contextEvidence ?? null,
          };
        }
        return prompt;
      });

      socket.emit('guidance:current_state', {
        sessionId: data.sessionId,
        prompts: serializedPrompts,
        tier1,
        tier2ByGroup,
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error('Get current state error:', error);
      socket.emit('error', {
        code: 'STATE_FETCH_FAILED',
        message: 'Failed to fetch current guidance state'
      });
    }
  }

  private async handleAnalyticsSubscription(socket: Socket, data: { sessionId?: string; metrics?: string[] }) {
    try {
      const socketData = socket.data as GuidanceSocketData;
      const allowedMetrics = new Set(['attention', 'tier2-shift']);
      const sessionKey = data.sessionId ?? 'global';
      const normalized = Array.isArray(data.metrics) && data.metrics.length > 0
        ? data.metrics
            .map((metric) => String(metric).toLowerCase())
            .filter((metric) => allowedMetrics.has(metric))
        : [];

      const requestedMetrics = normalized.length > 0 ? normalized : ['attention'];
      const requestedSet = new Set(requestedMetrics);

      const existing = socketData.analyticsSubscriptions.get(sessionKey) || new Set<string>();
      const toJoin = requestedMetrics.filter((metric) => !existing.has(metric));
      const toLeave = Array.from(existing).filter((metric) => !requestedSet.has(metric));

      for (const metric of toJoin) {
        const room = data.sessionId
          ? `analytics:session:${data.sessionId}:${metric}`
          : `analytics:global:${metric}`;
        await socket.join(room);
      }

      for (const metric of toLeave) {
        const room = data.sessionId
          ? `analytics:session:${data.sessionId}:${metric}`
          : `analytics:global:${metric}`;
        await socket.leave(room);
      }

      socketData.analyticsSubscriptions.set(sessionKey, new Set(requestedSet));

      socket.emit('analytics:subscribed', {
        sessionId: data.sessionId,
        metrics: Array.from(requestedSet),
        timestamp: new Date()
      });

      logger.debug(`Guidance namespace: Teacher ${socket.data.userId} subscribed to analytics`, {
        sessionId: data.sessionId || 'global',
        metrics: Array.from(requestedSet)
      });
    } catch (error) {
      logger.error('Analytics subscription error:', error);
      socket.emit('error', {
        code: 'ANALYTICS_SUBSCRIPTION_FAILED',
        message: 'Failed to subscribe to analytics'
      });
    }
  }

  private async handleAnalyticsUnsubscription(socket: Socket, data: { sessionId?: string; metrics?: string[] }) {
    try {
      const socketData = socket.data as GuidanceSocketData;
      const sessionKey = data.sessionId ?? 'global';
      const existing = socketData.analyticsSubscriptions.get(sessionKey);
      if (!existing || existing.size === 0) {
        socket.emit('analytics:subscribed', {
          sessionId: data.sessionId,
          metrics: [],
          timestamp: new Date()
        });
        return;
      }

      const allowedMetrics = new Set(['attention', 'tier2-shift']);
      const metricsToRemove = Array.isArray(data.metrics) && data.metrics.length > 0
        ? data.metrics.map((metric) => String(metric).toLowerCase()).filter((metric) => allowedMetrics.has(metric))
        : Array.from(existing);

      for (const metric of metricsToRemove) {
        existing.delete(metric);
        const room = data.sessionId
          ? `analytics:session:${data.sessionId}:${metric}`
          : `analytics:global:${metric}`;
        await socket.leave(room);
      }

      if (existing.size === 0) {
        socketData.analyticsSubscriptions.delete(sessionKey);
      } else {
        socketData.analyticsSubscriptions.set(sessionKey, existing);
      }

      socket.emit('analytics:subscribed', {
        sessionId: data.sessionId,
        metrics: existing ? Array.from(existing) : [],
        timestamp: new Date()
      });
    } catch (error) {
      logger.error('Analytics unsubscription error:', error);
      socket.emit('error', {
        code: 'ANALYTICS_UNSUBSCRIPTION_FAILED',
        message: 'Failed to unsubscribe from analytics'
      });
    }
  }

  // Processing Methods
  private async processPromptInteraction(data: PromptInteractionData, userId: string) {
    switch (data.action) {
      case 'acknowledge':
        await databricksService.update('teacher_guidance_metrics', data.promptId, {
          acknowledged_at: new Date(),
          acknowledged_by: userId
        });
        break;

      case 'use':
        await databricksService.update('teacher_guidance_metrics', data.promptId, {
          used_at: new Date(),
          used_by: userId,
          feedback: data.feedback || null,
          status: 'used'
        });
        break;

      case 'dismiss':
        await databricksService.update('teacher_guidance_metrics', data.promptId, {
          dismissed_at: new Date(),
          dismissed_by: userId,
          feedback: data.feedback || null,
          status: 'dismissed'
        });
        break;
    }

    // Record interaction analytics
    // TODO: Implement recordAnalyticsEvent method in DatabricksService
    try {
      await databricksService.insert('session_events', {
        id: `prompt_interaction_${data.promptId}_${Date.now()}`,
        session_id: data.sessionId,
        teacher_id: userId,
        event_type: 'prompt_interaction',
        event_time: new Date(),
        payload: JSON.stringify({
          promptId: data.promptId,
          action: data.action,
          feedback: data.feedback
        })
      });
    } catch (error) {
      logger.warn('Failed to record prompt interaction analytics:', error);
    }
  }

  private normalizePromptInteractionAction(action?: PromptInteractionAction | null): {
    canonicalAction?: Exclude<PromptInteractionAction, 'ack'>;
    metricsLabel: string;
  } {
    if (!action) {
      return { canonicalAction: undefined, metricsLabel: 'other' };
    }

    const normalized = String(action).toLowerCase();
    switch (normalized) {
      case 'ack':
      case 'acknowledge':
        return { canonicalAction: 'acknowledge', metricsLabel: 'ack' };
      case 'use':
        return { canonicalAction: 'use', metricsLabel: 'use' };
      case 'snooze':
        return { canonicalAction: 'snooze', metricsLabel: 'snooze' };
      case 'copy':
        return { canonicalAction: 'copy', metricsLabel: 'copy' };
      case 'save_exit_check':
      case 'save-exit-check':
        return { canonicalAction: 'save_exit_check', metricsLabel: 'save_exit_check' };
      case 'dismiss':
        return { canonicalAction: 'dismiss', metricsLabel: 'other' };
      default:
        return { canonicalAction: undefined, metricsLabel: 'other' };
    }
  }

  private async observePromptActionLatency(promptId?: string): Promise<void> {
    if (!promptId || typeof promptId !== 'string') {
      return;
    }
    const key = `guidance:prompt:first_emit_at:${promptId}`;
    try {
      const client = redisService.getClient();
      const firstEmit = await client.get(key);
      if (!firstEmit) {
        return;
      }
      const parsed = Number(firstEmit);
      if (Number.isFinite(parsed)) {
        const delta = Date.now() - parsed;
        if (delta >= 0) {
          try { GuidanceNamespaceService.promptFirstActionHistogram.observe(delta); } catch { /* intentionally ignored: best effort cleanup */ }
        }
      }
      await client.del(key);
    } catch (error) {
      this.handleRedisFailure('prompt_timing', error);
    }
  }

  private async recordPromptFirstEmitTimestamp(promptId?: string): Promise<void> {
    if (!promptId || typeof promptId !== 'string') {
      return;
    }
    try {
      const client = redisService.getClient();
      const key = `guidance:prompt:first_emit_at:${promptId}`;
      const ttlMs = 24 * 60 * 60 * 1000;
      await client.set(key, Date.now().toString(), 'PX', ttlMs, 'NX');
    } catch (error) {
      this.handleRedisFailure('prompt_timing', error);
    }
  }

  private adjustSessionSubscriberGauge(sessionId: string, delta: number): void {
    if (!sessionId) {
      return;
    }
    const current = this.sessionSubscriberCounts.get(sessionId) ?? 0;
    const next = Math.max(0, current + delta);
    if (next === 0) {
      this.sessionSubscriberCounts.delete(sessionId);
    } else {
      this.sessionSubscriberCounts.set(sessionId, next);
    }
    try { GuidanceNamespaceService.wsSubscribersGauge.set({ sessionId }, next); } catch { /* intentionally ignored: best effort cleanup */ }
  }

  private handleRedisFailure(component: GuidanceRedisComponent, error: unknown): void {
    try { GuidanceNamespaceService.redisUnavailableCounter.inc({ component }); } catch { /* intentionally ignored: best effort cleanup */ }
    const now = Date.now();
    const lastLogged = this.redisErrorLogTimestamps.get(component) ?? 0;
    if (now - lastLogged >= 60000) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`⚠️ Guidance Redis unavailable for ${component}: ${message}`);
      this.redisErrorLogTimestamps.set(component, now);
    }
  }

  // Utility Methods
  private notifySessionOfSubscriberChange(sessionId: string, userId: string, action: 'subscribed' | 'unsubscribed') {
    this.emitToRoom(`guidance:session:${sessionId}`, 'guidance:subscriber_change', {
      sessionId,
      userId,
      action,
      timestamp: new Date()
    });
  }

  // Public API for AI services to emit guidance events
  public emitTeacherAlert(sessionId: string, prompt: any): void {
    void this.recordPromptFirstEmitTimestamp(prompt?.id);

    const roomSession = `guidance:session:${sessionId}`;
    const roomAll = 'guidance:all';
    // Emit to session-specific guidance subscribers
    const ok1 = this.emitToRoom(roomSession, 'teacher:alert', prompt);
    // Also emit to general guidance subscribers
    const ok2 = this.emitToRoom(roomAll, 'teacher:alert', prompt);
    try { GuidanceNamespaceService.teacherAlertsEmits.inc({ namespace: this.getNamespaceName() }); } catch { /* intentionally ignored: best effort cleanup */ }
    // Treat no-subscriber case as a failed emit for metrics purposes
    const hasSessionSubs = (this.namespace.adapter.rooms.get(roomSession)?.size || 0) > 0;
    const hasAllSubs = (this.namespace.adapter.rooms.get(roomAll)?.size || 0) > 0;
    if (!hasSessionSubs && !hasAllSubs) {
      try { GuidanceNamespaceService.emitsFailed.inc({ namespace: this.getNamespaceName(), type: 'alert' }); } catch { /* intentionally ignored: best effort cleanup */ }
    }
    // Persist prompt event (non-blocking)
    (async () => {
      try {
        const { guidanceEventsService } = await import('../guidance-events.service');
        await guidanceEventsService.record({ sessionId, groupId: prompt?.groupId, type: 'prompt', payload: prompt, timestamp: new Date() });
      } catch { /* intentionally ignored: best effort cleanup */ }
    })();
  }

  public emitTeacherRecommendations(sessionId: string, prompts: any[], opts?: { generatedAt?: string | number; tier?: 'tier1' | 'tier2' }): void {
    const roomSession = `guidance:session:${sessionId}`;
    const roomAll = 'guidance:all';
    for (const prompt of Array.isArray(prompts) ? prompts : []) {
      const promptId = prompt?.id ?? prompt?.promptId;
      void this.recordPromptFirstEmitTimestamp(promptId);
    }
    const serializedPrompts = prompts.map((prompt) => {
      const { contextEvidence, context, ...rest } = prompt ?? {};
      const paragraph = contextEvidence?.contextSummary ?? context ?? null;
      return {
        ...rest,
        contextSummary: paragraph,
        context: contextEvidence ?? null,
      };
    });
    const ok1 = this.emitToRoom(roomSession, 'teacher:recommendations', serializedPrompts);
    const ok2 = this.emitToRoom(roomAll, 'teacher:recommendations', serializedPrompts);
    try { GuidanceNamespaceService.teacherRecsEmits.inc({ namespace: this.getNamespaceName() }); } catch { /* intentionally ignored: best effort cleanup */ }
    const hasSessionSubs = (this.namespace.adapter.rooms.get(roomSession)?.size || 0) > 0;
    const hasAllSubs = (this.namespace.adapter.rooms.get(roomAll)?.size || 0) > 0;
    if (!hasSessionSubs && !hasAllSubs) {
      try { GuidanceNamespaceService.emitsFailed.inc({ namespace: this.getNamespaceName(), type: 'recommendations' }); } catch { /* intentionally ignored: best effort cleanup */ }
    }
    // Prompt delivery SLIs (best-effort)
    (async () => {
      const tier = opts?.tier || 'tier1';
      let school = 'unknown';
      try {
        const { getCompositionRoot } = await import('../../app/composition-root');
        const repo = getCompositionRoot().getSessionRepository();
        const basic = await repo.getBasic(sessionId);
        school = (basic as any)?.school_id || 'unknown';
      } catch { /* intentionally ignored: best effort cleanup */ }
      const delivered = hasSessionSubs || hasAllSubs;
      try { GuidanceNamespaceService.promptDeliveryTotal.inc({ tier, status: delivered ? 'delivered' : 'no_subscriber', school }); } catch { /* intentionally ignored: best effort cleanup */ }
      if (opts?.generatedAt) {
        const started = typeof opts.generatedAt === 'string' ? new Date(opts.generatedAt).getTime() : Number(opts.generatedAt);
        if (!Number.isNaN(started)) {
          const latency = Date.now() - started;
          try { GuidanceNamespaceService.promptDeliveryLatency.observe({ tier }, latency); } catch { /* intentionally ignored: best effort cleanup */ }
        }
      }
      // Per-session SLI via Redis (to avoid high-cardinality Prometheus labels)
      try {
        const key = `sli:prompt_delivery:session:${sessionId}:${tier}:${delivered ? 'delivered' : 'no_subscriber'}`;
        await redisService.getClient().incr(key);
        // Keep counters ephemeral to bound storage
        await redisService.getClient().expire(key, parseInt(process.env.SLI_SESSION_TTL_SECONDS || '3600', 10));
      } catch { /* intentionally ignored: best effort cleanup */ }
    })();
    // Persist prompt recommendations as individual prompt events
    (async () => {
      try {
        const { guidanceEventsService } = await import('../guidance-events.service');
        for (const p of serializedPrompts) {
          await guidanceEventsService.record({ sessionId, groupId: p?.groupId, type: 'prompt', payload: p, timestamp: new Date() });
        }
      } catch { /* intentionally ignored: best effort cleanup */ }
    })();
  }

  public emitTier1Insight(sessionId: string, insight: any): void {
    const room = `guidance:session:${sessionId}`;
    const ok = this.emitToRoom(room, 'ai:tier1:insight', insight);
    try { GuidanceNamespaceService.tier1Emits.inc({ namespace: this.getNamespaceName() }); } catch { /* intentionally ignored: best effort cleanup */ }
    // Per-school SLI (best-effort)
    (async () => {
      try {
        const { getCompositionRoot } = await import('../../app/composition-root');
        const repo = getCompositionRoot().getSessionRepository();
        const basic = await repo.getBasic(sessionId);
        const school = (basic as any)?.school_id || 'unknown';
        try { GuidanceNamespaceService.tier1DeliveredBySchool.inc({ school }); } catch { /* intentionally ignored: best effort cleanup */ }
      } catch { /* intentionally ignored: best effort cleanup */ }
    })();
    const hasSubs = (this.namespace.adapter.rooms.get(room)?.size || 0) > 0;
    if (!hasSubs) {
      try { GuidanceNamespaceService.emitsFailed.inc({ namespace: this.getNamespaceName(), type: 'tier1' }); } catch { /* intentionally ignored: best effort cleanup */ }
    }
    // Persist tier1 insight
    (async () => {
      try {
        const { guidanceEventsService } = await import('../guidance-events.service');
        await guidanceEventsService.record({ sessionId, groupId: insight?.groupId, type: 'tier1', payload: insight, timestamp: new Date() });
      } catch { /* intentionally ignored: best effort cleanup */ }
    })();
  }

  public emitTier2Insight(sessionId: string, insight: any): void {
    if (!insight || !insight.groupId) {
      logger.warn('⚠️ Guidance: Dropping Tier2 emit without groupId (session-scope no longer supported)', { sessionId });
      return;
    }
    const room = `guidance:session:${sessionId}`;
    const ok = this.emitToRoom(room, 'ai:tier2:insight', insight);
    try { GuidanceNamespaceService.tier2Emits.inc({ namespace: this.getNamespaceName() }); } catch { /* intentionally ignored: best effort cleanup */ }
    (async () => {
      try {
        const { getCompositionRoot } = await import('../../app/composition-root');
        const repo = getCompositionRoot().getSessionRepository();
        const basic = await repo.getBasic(sessionId);
        const school = (basic as any)?.school_id || 'unknown';
        try { GuidanceNamespaceService.tier2DeliveredBySchool.inc({ school }); } catch { /* intentionally ignored: best effort cleanup */ }
      } catch { /* intentionally ignored: best effort cleanup */ }
    })();
    const hasSubs = (this.namespace.adapter.rooms.get(room)?.size || 0) > 0;
    if (!hasSubs) {
      try { GuidanceNamespaceService.emitsFailed.inc({ namespace: this.getNamespaceName(), type: 'tier2' }); } catch { /* intentionally ignored: best effort cleanup */ }
    }
    // Persist tier2 insight
    (async () => {
      try {
        const { guidanceEventsService } = await import('../guidance-events.service');
        await guidanceEventsService.record({ sessionId, groupId: insight?.groupId, type: 'tier2', payload: insight, timestamp: new Date() });
      } catch { /* intentionally ignored: best effort cleanup */ }
    })();
  }

  public emitGuidanceAnalytics(event: WsGuidanceAnalyticsEvent): void {
    const category = event.category;
    const sessionRoom = `analytics:session:${event.sessionId}:${category}`;
    const globalRoom = `analytics:global:${category}`;

    const deliveredSession = this.emitToRoom(sessionRoom, 'guidance:analytics', event);
    const deliveredGlobal = this.emitToRoom(globalRoom, 'guidance:analytics', event);

    if (!deliveredSession && !deliveredGlobal) {
      try { GuidanceNamespaceService.emitsFailed.inc({ namespace: this.getNamespaceName(), type: `analytics_${category}` }); } catch { /* intentionally ignored: best effort cleanup */ }
    }
  }

  // Generic cache update emission for clients subscribed to guidance namespace
  public emitCacheUpdatedGlobal(payload: any): void {
    this.emitToRoom('guidance:all', 'cache:updated', payload);
  }

  public getSessionGuidanceSubscribers(sessionId: string): string[] {
    const room = this.namespace.adapter.rooms.get(`guidance:session:${sessionId}`);
    if (!room) return [];

    const subscribers: string[] = [];
    for (const socketId of room) {
      const socket = this.namespace.sockets.get(socketId);
      if (socket?.data.userId) {
        subscribers.push(socket.data.userId);
      }
    }
    return subscribers;
  }
}

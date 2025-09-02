import { Socket } from 'socket.io';
import { NamespaceBaseService, NamespaceSocketData } from './namespace-base.service';
import { databricksService } from '../databricks.service';
import { teacherPromptService } from '../teacher-prompt.service';
import { aiAnalysisBufferService } from '../ai-analysis-buffer.service';
import { alertPrioritizationService } from '../alert-prioritization.service';

interface GuidanceSocketData extends NamespaceSocketData {
  subscribedSessions: Set<string>;
  subscriptions: Set<string>;
}

interface SubscriptionData {
  sessionId?: string;
  subscriptions?: string[];
}

interface PromptInteractionData {
  promptId: string;
  action: 'acknowledge' | 'use' | 'dismiss';
  feedback?: string;
  sessionId?: string;
}

export class GuidanceNamespaceService extends NamespaceBaseService {
  protected getNamespaceName(): string {
    return '/guidance';
  }

  protected onConnection(socket: Socket): void {
    const socketData = socket.data as GuidanceSocketData;
    socketData.subscribedSessions = new Set();
    socketData.subscriptions = new Set();

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
    socket.on('prompt:interact', async (data: PromptInteractionData) => {
      await this.handlePromptInteraction(socket, data);
    });

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

    console.log(`Guidance namespace: Teacher ${socket.data.userId} connected for guidance`);
  }

  protected onDisconnection(socket: Socket, reason: string): void {
    const socketData = socket.data as GuidanceSocketData;
    
    // Clean up subscriptions
    if (socketData.subscribedSessions) {
      socketData.subscribedSessions.forEach(sessionId => {
        this.notifySessionOfSubscriberChange(sessionId, socket.data.userId, 'unsubscribed');
      });
    }
  }

  protected onUserFullyDisconnected(userId: string): void {
    // Update guidance system that teacher is offline
    console.log(`Guidance namespace: Teacher ${userId} fully disconnected from guidance`);
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

      console.log(`Guidance namespace: Teacher ${socket.data.userId} subscribed to guidance`);
    } catch (error) {
      console.error('Guidance subscription error:', error);
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
      console.error('Guidance unsubscription error:', error);
      socket.emit('error', {
        code: 'UNSUBSCRIPTION_FAILED',
        message: 'Failed to unsubscribe from guidance'
      });
    }
  }

  private async handleSessionGuidanceSubscription(socket: Socket, data: { sessionId: string }) {
    try {
      // Verify teacher owns this session
      const session = await databricksService.queryOne(
        `SELECT id, status FROM classwaves.sessions.classroom_sessions 
         WHERE id = ? AND teacher_id = ?`,
        [data.sessionId, socket.data.userId]
      );

      if (!session) {
        socket.emit('error', {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found or not owned by user'
        });
        return;
      }

      const socketData = socket.data as GuidanceSocketData;
      socketData.subscribedSessions.add(data.sessionId);

      // Join session-specific guidance room
      const roomName = `guidance:session:${data.sessionId}`;
      await socket.join(roomName);

      // Notify that teacher is monitoring this session
      this.notifySessionOfSubscriberChange(data.sessionId, socket.data.userId, 'subscribed');

      socket.emit('session:guidance:subscribed', {
        sessionId: data.sessionId,
        sessionStatus: session.status,
        timestamp: new Date()
      });

      console.log(`Guidance namespace: Teacher ${socket.data.userId} subscribed to session ${data.sessionId} guidance`);
    } catch (error) {
      console.error('Session guidance subscription error:', error);
      socket.emit('error', {
        code: 'SESSION_SUBSCRIPTION_FAILED',
        message: 'Failed to subscribe to session guidance'
      });
    }
  }

  private async handleSessionGuidanceUnsubscription(socket: Socket, data: { sessionId: string }) {
    try {
      const socketData = socket.data as GuidanceSocketData;
      socketData.subscribedSessions.delete(data.sessionId);

      const roomName = `guidance:session:${data.sessionId}`;
      await socket.leave(roomName);

      this.notifySessionOfSubscriberChange(data.sessionId, socket.data.userId, 'unsubscribed');

      socket.emit('session:guidance:unsubscribed', {
        sessionId: data.sessionId,
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Session guidance unsubscription error:', error);
      socket.emit('error', {
        code: 'SESSION_UNSUBSCRIPTION_FAILED',
        message: 'Failed to unsubscribe from session guidance'
      });
    }
  }

  // Prompt Interaction Handlers
  private async handlePromptInteraction(socket: Socket, data: PromptInteractionData) {
    try {
      // Verify prompt belongs to teacher or session they own
      const prompt = await databricksService.queryOne(
        `SELECT p.id, p.session_id, s.teacher_id 
         FROM classwaves.ai_insights.teacher_guidance_metrics p
         JOIN classwaves.sessions.classroom_sessions s ON p.session_id = s.id
         WHERE p.id = ? AND s.teacher_id = ?`,
        [data.promptId, socket.data.userId]
      );

      if (!prompt) {
        socket.emit('error', {
          code: 'PROMPT_NOT_FOUND',
          message: 'Prompt not found or access denied'
        });
        return;
      }

      // Process the interaction
      await this.processPromptInteraction(data, socket.data.userId);

      // Broadcast interaction to session guidance subscribers
      if (prompt.session_id) {
        this.emitToRoom(`guidance:session:${prompt.session_id}`, 'prompt:interaction', {
          promptId: data.promptId,
          action: data.action,
          userId: socket.data.userId,
          feedback: data.feedback,
          timestamp: new Date()
        });
      }

      socket.emit('prompt:interaction_confirmed', {
        promptId: data.promptId,
        action: data.action,
        timestamp: new Date()
      });

      console.log(`Guidance namespace: Teacher ${socket.data.userId} ${data.action} prompt ${data.promptId}`);
    } catch (error) {
      console.error('Prompt interaction error:', error);
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
          console.warn(`⚠️ Failed to get active prompts for session ${data.sessionId}:`, error);
          prompts = []; // Graceful degradation
        }

        try {
          insights = await aiAnalysisBufferService.getCurrentInsights(data.sessionId, {
            maxAge: 10, // Last 10 minutes for real-time relevance
            includeMetadata: true
          });
        } catch (error) {
          console.warn(`⚠️ Failed to get current insights for session ${data.sessionId}:`, error);
          insights = {}; // Graceful degradation
        }
      } else {
        // Get all active prompts for this teacher
        prompts = await databricksService.query(
          `SELECT p.* FROM classwaves.ai_insights.teacher_guidance_metrics p
           JOIN classwaves.sessions.classroom_sessions s ON p.session_id = s.id
           WHERE s.teacher_id = ? AND p.status = 'active'
           ORDER BY p.priority_level DESC, p.generated_at DESC`,
          [socket.data.userId]
        );
      }

      socket.emit('guidance:current_state', {
        prompts,
        insights,
        sessionId: data.sessionId,
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Get current state error:', error);
      socket.emit('error', {
        code: 'STATE_FETCH_FAILED',
        message: 'Failed to fetch current guidance state'
      });
    }
  }

  private async handleAnalyticsSubscription(socket: Socket, data: { sessionId?: string; metrics?: string[] }) {
    try {
      const roomName = data.sessionId 
        ? `analytics:session:${data.sessionId}`
        : 'analytics:global';

      await socket.join(roomName);

      socket.emit('analytics:subscribed', {
        sessionId: data.sessionId,
        metrics: data.metrics || ['all'],
        timestamp: new Date()
      });

      console.log(`Guidance namespace: Teacher ${socket.data.userId} subscribed to analytics`);
    } catch (error) {
      console.error('Analytics subscription error:', error);
      socket.emit('error', {
        code: 'ANALYTICS_SUBSCRIPTION_FAILED',
        message: 'Failed to subscribe to analytics'
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
      console.warn('Failed to record prompt interaction analytics:', error);
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
    // Emit to session-specific guidance subscribers
    this.emitToRoom(`guidance:session:${sessionId}`, 'teacher:alert', prompt);
    
    // Also emit to general guidance subscribers
    this.emitToRoom('guidance:all', 'teacher:alert', prompt);
  }

  public emitTeacherRecommendations(sessionId: string, prompts: any[]): void {
    this.emitToRoom(`guidance:session:${sessionId}`, 'teacher:recommendations', prompts);
    this.emitToRoom('guidance:all', 'teacher:recommendations', prompts);
  }

  public emitTier1Insight(sessionId: string, insight: any): void {
    this.emitToRoom(`guidance:session:${sessionId}`, 'ai:tier1:insight', insight);
  }

  public emitTier2Insight(sessionId: string, insight: any): void {
    this.emitToRoom(`guidance:session:${sessionId}`, 'ai:tier2:insight', insight);
  }

  public emitGuidanceAnalytics(sessionId: string, analytics: any): void {
    this.emitToRoom(`analytics:session:${sessionId}`, 'guidance:analytics', analytics);
    this.emitToRoom('analytics:global', 'guidance:analytics', analytics);
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

import { EventEmitter } from 'events';
import { cacheManager } from './cache-manager.service';
import { bumpTagEpoch } from './tag-epoch.service';
import { getNamespacedWebSocketService } from './websocket/namespaced-websocket.service';

/**
 * Event-Driven Cache Invalidation System
 * Decouples business logic from cache management through domain events
 */

// Domain Event Types
export interface DomainEvent {
  type: string;
  timestamp: number;
  correlationId?: string;
  metadata?: Record<string, any>;
}

export interface SessionCreatedEvent extends DomainEvent {
  type: 'session.created';
  payload: {
    sessionId: string;
    teacherId: string;
    schoolId: string;
  };
}

export interface SessionUpdatedEvent extends DomainEvent {
  type: 'session.updated';
  payload: {
    sessionId: string;
    teacherId: string;
    changes: string[];
  };
}

export interface SessionDeletedEvent extends DomainEvent {
  type: 'session.deleted';
  payload: {
    sessionId: string;
    teacherId: string;
  };
}

export interface SessionStatusChangedEvent extends DomainEvent {
  type: 'session.status_changed';
  payload: {
    sessionId: string;
    teacherId: string;
    oldStatus: string;
    newStatus: string;
  };
}

export interface TeacherUpdatedEvent extends DomainEvent {
  type: 'teacher.updated';
  payload: {
    teacherId: string;
    schoolId: string;
    changes: string[];
  };
}

export type CacheEvent = 
  | SessionCreatedEvent 
  | SessionUpdatedEvent 
  | SessionDeletedEvent 
  | SessionStatusChangedEvent
  | TeacherUpdatedEvent;

/**
 * Cache invalidation strategies for different event types
 */
export class CacheInvalidationStrategies {
  private static emitCacheUpdated(payload: { scope: 'teacher' | 'session' | 'analytics'; teacherId?: string; sessionId?: string; tags?: string[]; changes?: string[] }) {
    try {
      const ws = getNamespacedWebSocketService();
      if (!ws) return;
      const stamp = { ...payload, timestamp: Date.now() };
      if (payload.scope === 'session' && payload.sessionId) {
        ws.getSessionsService().emitToSession(payload.sessionId, 'cache:updated', stamp);
      }
      // Emit to guidance:all for dashboards/teacher pages
      ws.getGuidanceService().emitCacheUpdatedGlobal(stamp);
    } catch (e) {
      console.warn('⚠️  WS cache:updated emit failed:', e instanceof Error ? e.message : String(e));
    }
  }
  
  /**
   * Session created - invalidate teacher's session lists
   */
  static async handleSessionCreated(event: SessionCreatedEvent): Promise<void> {
    const { teacherId, schoolId } = event.payload;
    
    console.log(`🔄 Handling session created event for teacher ${teacherId}`);
    
    // Invalidate teacher's session lists
    await cacheManager.invalidateByTag(`teacher:${teacherId}`);
    // Bump epoch for teacher lists (O(1) invalidation)
    await bumpTagEpoch(`teacher:${teacherId}`);
    CacheInvalidationStrategies.emitCacheUpdated({ scope: 'teacher', teacherId, tags: [`teacher:${teacherId}`], changes: ['session.created'] });
    
    // Invalidate school-wide session caches if they exist
    await cacheManager.invalidateByTag(`school:${schoolId}`);
    
    // Warm common cache entries
    setTimeout(() => {
      CacheWarmer.warmTeacherSessions(teacherId);
    }, 100); // Small delay to ensure DB write is committed
  }

  /**
   * Session updated - selective invalidation based on changes
   */
  static async handleSessionUpdated(event: SessionUpdatedEvent): Promise<void> {
    const { sessionId, teacherId, changes } = event.payload;
    
    console.log(`🔄 Handling session updated event for session ${sessionId}, changes:`, changes);
    
    // Always invalidate the specific session detail
    await cacheManager.invalidateByTag(`session:${sessionId}`);
    await bumpTagEpoch(`session:${sessionId}`);
    CacheInvalidationStrategies.emitCacheUpdated({ scope: 'session', sessionId, tags: [`session:${sessionId}`], changes });
    
    // If metadata changed (title, description, etc), invalidate lists
    const listAffectingChanges = ['title', 'description', 'status', 'scheduled_start'];
    if (changes.some(change => listAffectingChanges.includes(change))) {
      await cacheManager.invalidateByTag(`teacher:${teacherId}`);
      await bumpTagEpoch(`teacher:${teacherId}`);
      CacheInvalidationStrategies.emitCacheUpdated({ scope: 'teacher', teacherId, tags: [`teacher:${teacherId}`], changes });
    }
    
    // If analytics-related changes, invalidate analytics caches
    const analyticsChanges = ['status', 'actual_start', 'actual_end'];
    if (changes.some(change => analyticsChanges.includes(change))) {
      await cacheManager.invalidateByTag(`analytics:${sessionId}`);
      await bumpTagEpoch(`analytics:${sessionId}`);
      CacheInvalidationStrategies.emitCacheUpdated({ scope: 'analytics', sessionId, tags: [`analytics:${sessionId}`], changes });
    }
  }

  /**
   * Session deleted - comprehensive cleanup
   */
  static async handleSessionDeleted(event: SessionDeletedEvent): Promise<void> {
    const { sessionId, teacherId } = event.payload;
    
    console.log(`🔄 Handling session deleted event for session ${sessionId}`);
    
    // Invalidate all session-related caches
    await Promise.all([
      cacheManager.invalidateByTag(`session:${sessionId}`),
      cacheManager.invalidateByTag(`analytics:${sessionId}`),
      cacheManager.invalidateByTag(`teacher:${teacherId}`),
      bumpTagEpoch(`session:${sessionId}`),
      bumpTagEpoch(`analytics:${sessionId}`),
      bumpTagEpoch(`teacher:${teacherId}`),
    ]);
    CacheInvalidationStrategies.emitCacheUpdated({ scope: 'session', sessionId, tags: [`session:${sessionId}`, `analytics:${sessionId}`, `teacher:${teacherId}`], changes: ['session.deleted'] });
  }

  /**
   * Session status changed - targeted invalidation
   */
  static async handleSessionStatusChanged(event: SessionStatusChangedEvent): Promise<void> {
    const { sessionId, teacherId, oldStatus, newStatus } = event.payload;
    
    console.log(`🔄 Session ${sessionId} status: ${oldStatus} → ${newStatus}`);
    
    // Always invalidate session detail and teacher lists
    await Promise.all([
      cacheManager.invalidateByTag(`session:${sessionId}`),
      cacheManager.invalidateByTag(`teacher:${teacherId}`),
      bumpTagEpoch(`session:${sessionId}`),
      bumpTagEpoch(`teacher:${teacherId}`),
    ]);
    CacheInvalidationStrategies.emitCacheUpdated({ scope: 'session', sessionId, tags: [`session:${sessionId}`, `teacher:${teacherId}`], changes: ['status_changed'] });
    
    // If session ended, invalidate analytics (they become available)
    if (newStatus === 'ended') {
      await cacheManager.invalidateByTag(`analytics:${sessionId}`);
      await bumpTagEpoch(`analytics:${sessionId}`);
      CacheInvalidationStrategies.emitCacheUpdated({ scope: 'analytics', sessionId, tags: [`analytics:${sessionId}`], changes: ['session.ended'] });
    }
    
    // If session started, warm real-time data caches
    if (newStatus === 'active') {
      setTimeout(() => {
        CacheWarmer.warmActiveSessionData(sessionId);
      }, 100);
    }
  }

  /**
   * Teacher updated - selective invalidation
   */
  static async handleTeacherUpdated(event: TeacherUpdatedEvent): Promise<void> {
    const { teacherId, changes } = event.payload;
    
    console.log(`🔄 Teacher ${teacherId} updated, changes:`, changes);
    
    // If profile data changed, invalidate teacher-related caches
    const profileChanges = ['name', 'email', 'role', 'status'];
    if (changes.some(change => profileChanges.includes(change))) {
      await cacheManager.invalidateByTag(`teacher:${teacherId}`);
       await bumpTagEpoch(`teacher:${teacherId}`);
       CacheInvalidationStrategies.emitCacheUpdated({ scope: 'teacher', teacherId, tags: [`teacher:${teacherId}`], changes });
    }
  }
}

/**
 * Intelligent cache warming strategies
 */
export class CacheWarmer {
  
  /**
   * Warm teacher's common session queries
   */
  static async warmTeacherSessions(teacherId: string): Promise<void> {
    try {
      console.log(`🔥 Warming session caches for teacher ${teacherId}`);
      
      // Import dynamically to avoid circular dependencies
      const { getTeacherSessionsOptimized } = await import('../controllers/session.controller');
      
      // Common query patterns to pre-warm
      const commonQueries = [
        { limit: 3, tags: [`teacher:${teacherId}`, 'sessions'], ttl: 300 },   // Dashboard
        { limit: 20, tags: [`teacher:${teacherId}`, 'sessions'], ttl: 300 },  // Sessions page
      ];
      
      // Execute warming in background (don't await to avoid blocking)
      Promise.all(
        commonQueries.map(async ({ limit, tags, ttl }) => {
          try {
            const cacheKey = `sessions:teacher:${teacherId}:limit:${limit}`;
            const data = await getTeacherSessionsOptimized(teacherId, limit);
            await cacheManager.set(cacheKey, data, { tags, ttl, autoWarm: false });
            console.log(`🔥 Warmed cache: ${cacheKey}`);
          } catch (error) {
            console.warn(`⚠️ Cache warming failed for ${teacherId}:`, error);
          }
        })
      ).catch(error => {
        console.warn('Cache warming batch failed:', error);
      });
      
    } catch (error) {
      console.warn(`Cache warming failed for teacher ${teacherId}:`, error);
    }
  }
  
  /**
   * Warm active session real-time data
   */
  static async warmActiveSessionData(sessionId: string): Promise<void> {
    try {
      console.log(`🔥 Warming active session data for ${sessionId}`);
      
      // Pre-warm commonly accessed data for active sessions
      // This is a placeholder - implement based on actual data access patterns
      
    } catch (error) {
      console.warn(`Active session cache warming failed for ${sessionId}:`, error);
    }
  }
}

/**
 * Main Cache Event Bus
 * Handles domain events and routes them to appropriate invalidation strategies
 */
export class CacheEventBus extends EventEmitter {
  private static instance: CacheEventBus;
  private isEnabled = true;
  private eventCount = 0;
  
  private constructor() {
    super();
    this.setupEventHandlers();
  }
  
  static getInstance(): CacheEventBus {
    if (!CacheEventBus.instance) {
      CacheEventBus.instance = new CacheEventBus();
    }
    return CacheEventBus.instance;
  }
  
  /**
   * Emit a domain event for cache invalidation
   */
  async emitCacheEvent(event: CacheEvent): Promise<void> {
    if (!this.isEnabled) {
      console.log('Cache event bus disabled, skipping event:', event.type);
      return;
    }
    
    try {
      this.eventCount++;
      console.log(`📡 Cache event #${this.eventCount}: ${event.type}`);
      
      // Emit to internal handlers
      this.emit(event.type, event);
      
      // Emit generic event for monitoring
      this.emit('cache:event', event);
      
    } catch (error) {
      console.error('Cache event emission failed:', error);
    }
  }
  
  /**
   * Convenience methods for common events
   */
  async sessionCreated(sessionId: string, teacherId: string, schoolId: string): Promise<void> {
    await this.emitCacheEvent({
      type: 'session.created',
      timestamp: Date.now(),
      payload: { sessionId, teacherId, schoolId },
    });
  }
  
  async sessionUpdated(sessionId: string, teacherId: string, changes: string[]): Promise<void> {
    await this.emitCacheEvent({
      type: 'session.updated',
      timestamp: Date.now(),
      payload: { sessionId, teacherId, changes },
    });
  }
  
  async sessionDeleted(sessionId: string, teacherId: string): Promise<void> {
    await this.emitCacheEvent({
      type: 'session.deleted',
      timestamp: Date.now(),
      payload: { sessionId, teacherId },
    });
  }
  
  async sessionStatusChanged(
    sessionId: string, 
    teacherId: string, 
    oldStatus: string, 
    newStatus: string
  ): Promise<void> {
    await this.emitCacheEvent({
      type: 'session.status_changed',
      timestamp: Date.now(),
      payload: { sessionId, teacherId, oldStatus, newStatus },
    });
  }
  
  /**
   * Enable/disable event processing
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    console.log(`Cache event bus ${enabled ? 'enabled' : 'disabled'}`);
  }
  
  /**
   * Get event statistics
   */
  getStats() {
    return {
      enabled: this.isEnabled,
      eventCount: this.eventCount,
      listenerCount: this.listenerCount('cache:event'),
    };
  }
  
  /**
   * Set up event handlers for different domain events
   */
  private setupEventHandlers(): void {
    this.on('session.created', CacheInvalidationStrategies.handleSessionCreated);
    this.on('session.updated', CacheInvalidationStrategies.handleSessionUpdated);
    this.on('session.deleted', CacheInvalidationStrategies.handleSessionDeleted);
    this.on('session.status_changed', CacheInvalidationStrategies.handleSessionStatusChanged);
    this.on('teacher.updated', CacheInvalidationStrategies.handleTeacherUpdated);
    
    // Global error handler
    this.on('error', (error) => {
      console.error('Cache event bus error:', error);
    });
    
    // Monitoring events
    this.on('cache:event', (event: CacheEvent) => {
      // Could send to monitoring service (DataDog, New Relic, etc.)
      console.log(`📊 Cache event processed: ${event.type} at ${new Date(event.timestamp).toISOString()}`);
    });
  }
}

// Singleton instance
export const cacheEventBus = CacheEventBus.getInstance();

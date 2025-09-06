import { Router } from 'express';
import { 
  listSessions, 
  createSession, 
  getSession,
  updateSession,
  deleteSession,
  startSession,
  pauseSession,
  endSession,
  getSessionAnalytics,
  joinSession,
  getSessionParticipants,
  resendSessionEmail,
  getGroupsStatus,
  getCacheHealth,
  getDashboardMetrics
} from '../controllers/session.controller';
import { authenticate } from '../middleware/auth.middleware';
import { databricksService } from '../services/databricks.service';
import { validate } from '../middleware/validation.middleware';
import { createSessionSchema } from '../utils/validation.schemas';


const router = Router();

// Session CRUD
router.get('/', authenticate, listSessions);
router.post('/', authenticate, validate(createSessionSchema), createSession);
router.get('/:sessionId', authenticate, getSession);
router.put('/:sessionId', authenticate, updateSession);
router.delete('/:sessionId', authenticate, deleteSession);

// Session lifecycle
router.post('/:sessionId/start', authenticate, startSession);
router.post('/:sessionId/pause', authenticate, pauseSession);
router.post('/:sessionId/end', authenticate, endSession);
router.get('/:sessionId/analytics', authenticate, getSessionAnalytics);

// Public student join endpoint (no auth)
router.post('/join', joinSession);
router.post('/:sessionId/join', joinSession);

// WebSocket connection debug endpoint  
router.get('/:sessionId/websocket-debug', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    // Check if Namespaced WebSocket service is available
    const { getNamespacedWebSocketService } = require('../services/websocket/namespaced-websocket.service');
    const namespacedWS = getNamespacedWebSocketService();
    
    const debugInfo = {
      sessionId,
      namespacedWebsocketAvailable: !!namespacedWS,
      sessionsNamespace: namespacedWS ? '/sessions' : 'not_available',
      guidanceNamespace: namespacedWS ? '/guidance' : 'not_available',
      sessionRoom: `session:${sessionId}`,
      timestamp: new Date().toISOString()
    };
    
    // Try to emit a test event to the sessions namespace
    if (namespacedWS) {
      const sessionsService = namespacedWS.getSessionsService();
      if (sessionsService) {
        // Emit debug event to sessions namespace
        console.log(`🔧 DEBUG: Emitting test event to sessions namespace for session ${sessionId}`);
      }
    }
    
    return res.json(debugInfo);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'WEBSOCKET_DEBUG_FAILED', message: errorMessage });
  }
});

// Debug endpoint for student session status (no auth required)
router.get('/:sessionId/student-debug/:studentId', async (req, res) => {
  try {
    const { sessionId, studentId } = req.params;
    
    // Check participant record
    const participant = await databricksService.queryOne(
      `SELECT 
         p.id,
         p.session_id,
         p.student_id,
         p.group_id,
         p.is_active,
         p.join_time,
         p.device_type,
         sg.name as group_name 
       FROM classwaves.sessions.participants p 
       LEFT JOIN classwaves.sessions.student_groups sg ON p.group_id = sg.id
       WHERE p.session_id = ? AND p.student_id = ?`,
      [sessionId, studentId]
    );
    
    // Check session status
    const session = await databricksService.queryOne(
      `SELECT id, status, access_code FROM classwaves.sessions.classroom_sessions WHERE id = ?`,
      [sessionId]
    );
    
    return res.json({
      sessionId,
      studentId,
      participant,
      session,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Debug endpoint error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'DEBUG_FAILED', message: errorMessage });
  }
});

// Clear WebSocket connection limits for student (dev only)
router.post('/clear-connection-limits/:studentId', async (req, res) => {
  try {
    if (process.env.NODE_ENV !== 'development') {
      return res.status(403).json({ error: 'DEV_ONLY', message: 'Only available in development' });
    }
    
    const { studentId } = req.params;
    const { redisService } = require('../services/redis.service');
    
    // Clear connection counters for all namespaces
    const namespaces = ['/sessions', '/guidance', '/admin'];
    const clearPromises = namespaces.map(namespace => {
      const key = 'websocket_connections:' + namespace + ':' + studentId;
      return redisService.del(key);
    });
    
    await Promise.all(clearPromises);
    
    return res.json({
      success: true,
      message: 'Cleared connection limits for student ' + studentId,
      cleared: namespaces,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Clear connection limits error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'CLEAR_FAILED', message: errorMessage });
  }
});

// Participants (teacher auth)
router.get('/:sessionId/participants', authenticate, getSessionParticipants);

// State reconciliation endpoint for WebSocket sync
router.get('/:sessionId/groups/status', authenticate, getGroupsStatus);

// Email notification endpoints
router.post('/:sessionId/resend-email', authenticate, resendSessionEmail);

// Dashboard metrics endpoint
router.get('/dashboard-metrics', authenticate, getDashboardMetrics);

// Cache health and management endpoint (for monitoring and debugging)
router.get('/admin/cache-health', authenticate, getCacheHealth);

export default router;

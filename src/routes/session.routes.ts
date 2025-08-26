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
  clearSessionListCache
} from '../controllers/session.controller';
import { authenticate } from '../middleware/auth.middleware';
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

// Participants (teacher auth)
router.get('/:sessionId/participants', authenticate, getSessionParticipants);

// State reconciliation endpoint for WebSocket sync
router.get('/:sessionId/groups/status', authenticate, getGroupsStatus);

// Email notification endpoints
router.post('/:sessionId/resend-email', authenticate, resendSessionEmail);

// Temporary cache clearing endpoint (for debugging/fixing cache issues)
router.post('/admin/clear-cache', authenticate, clearSessionListCache);

export default router;
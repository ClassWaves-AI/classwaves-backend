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
  getSessionParticipants
} from '../controllers/session.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { createSessionSchema } from '../utils/validation.schemas';
import groupRoutes from './group.routes';

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
router.post('/:sessionId/join', joinSession);

// Participants (teacher auth)
router.get('/:sessionId/participants', authenticate, getSessionParticipants);

// Group management (nested routes)
router.use('/:sessionId/groups', groupRoutes);
// router.get('/:sessionId/groups', getSessionGroups);
// router.post('/:sessionId/groups', createGroup);
// router.post('/:sessionId/groups/auto-generate', autoGenerateGroups);
// router.post('/:sessionId/join', joinSession);
// router.get('/:sessionId/transcriptions', getTranscriptions);
// router.get('/:sessionId/analytics', getSessionAnalytics);
// router.get('/:sessionId/insights/realtime', getRealtimeInsights);
// router.post('/:sessionId/summary', generateSummary);
// router.get('/:sessionId/export', exportSession);

export default router;
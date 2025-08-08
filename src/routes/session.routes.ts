import { Router } from 'express';
import { 
  listSessions, 
  createSession, 
  getSession,
  updateSession,
  deleteSession,
  startSession,
  pauseSession,
  endSession 
} from '../controllers/session.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { createSessionSchema } from '../utils/validation.schemas';
import groupRoutes from './group.routes';

const router = Router();

// All session routes require authentication
router.use(authenticate);

// Session CRUD
router.get('/', listSessions);
router.post('/', validate(createSessionSchema), createSession);
router.get('/:sessionId', getSession);
router.put('/:sessionId', updateSession);
router.delete('/:sessionId', deleteSession);

// Session lifecycle
router.post('/:sessionId/start', startSession);
router.post('/:sessionId/pause', pauseSession);
router.post('/:sessionId/end', endSession);

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
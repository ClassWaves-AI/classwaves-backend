import { Router } from 'express';
import { authenticate as authMiddleware } from '../middleware/auth.middleware';
import { transcriptService } from '../services/transcript.service';
import { validateQuery } from '../middleware/validation.middleware';
import { transcriptsQuerySchema } from '../utils/validation.schemas';
import { ok, fail, ErrorCodes } from '../utils/api-response';

const router = Router();

// GET /api/v1/transcripts?sessionId=&groupId=&since=&until=
router.get('/', authMiddleware, validateQuery(transcriptsQuerySchema), async (req, res) => {
  try {
    const { sessionId, groupId, since, until } = req.query as any;
    const segments = await transcriptService.read(sessionId, groupId, since, until);
    return ok(res, { sessionId, groupId, segments });
  } catch (e) {
    return fail(res, ErrorCodes.INTERNAL_ERROR, 'Failed to fetch transcripts', 500);
  }
});

export default router;

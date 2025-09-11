import { Router } from 'express';
import { authenticate as authMiddleware } from '../middleware/auth.middleware';
import { transcriptService } from '../services/transcript.service';

const router = Router();

// GET /api/v1/transcripts?sessionId=&groupId=&since=&until=
router.get('/', authMiddleware, async (req, res) => {
  try {
    const sessionId = String(req.query.sessionId || '').trim();
    const groupId = String(req.query.groupId || '').trim();
    const since = req.query.since != null ? Number(req.query.since) : undefined;
    const until = req.query.until != null ? Number(req.query.until) : undefined;
    if (!sessionId || !groupId) return res.status(400).json({ error: 'MISSING_PARAMS' });
    const segments = await transcriptService.read(sessionId, groupId, since, until);
    return res.json({ ok: true, sessionId, groupId, segments });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'TRANSCRIPT_FETCH_FAILED' });
  }
});

export default router;

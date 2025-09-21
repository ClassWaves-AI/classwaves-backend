import { Router, Request, Response, NextFunction } from 'express';
import { SecureJWTService } from '../services/secure-jwt.service';
import { getNamespacedWebSocketService } from '../services/websocket/namespaced-websocket.service';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

const router = Router();

// Middleware to protect test-only endpoints
const requireTestSecret = (req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV !== 'test' || req.header('e2e_test_secret') !== 'test') {
    return res.status(403).json({ success: false, error: 'Forbidden: This endpoint is for testing only.' });
  }
  next();
};

/**
 * Endpoint to generate a student token for E2E testing.
 * Creates mock test data without database operations for SQLite compatibility.
 *
 * @see /Users/rtaroncher/Documents/SandBoxAI/ClassWaves/checkpoints/WIP/Features/STUDENT_PORTAL_E2E_TESTING_SOW.md
 */
router.post('/generate-student-token', requireTestSecret, async (req, res) => {
  try {
    const { sessionCode, studentName, gradeLevel, isLeader, isUnderage } = req.body;
    if (!sessionCode || !studentName || !gradeLevel) {
      return res.status(400).json({ success: false, error: 'sessionCode, studentName, and gradeLevel are required.' });
    }

    logger.debug('🔧 Generating student token for E2E test:', { sessionCode, studentName, gradeLevel });

    // For E2E testing, create mock IDs and data without database operations
    const sessionId = `e2e-session-${sessionCode}`;
    const studentId = `e2e-student-${Date.now()}`;
    const groupId = `e2e-group-${Date.now()}`;

    // Create mock entities for E2E testing (no database calls)
    const session = {
      id: sessionId,
      title: `E2E Test Session ${sessionCode}`,
      description: 'An automated test session.',
      teacher_id: 'e2e-test-teacher',
      school_id: 'e2e-test-school',
      access_code: sessionCode,
      target_group_size: 4,
      auto_group_enabled: true,
      scheduled_start: new Date(),
      planned_duration_minutes: 60,
      status: 'created',
      recording_enabled: false,
      transcription_enabled: true,
      ai_analysis_enabled: true,
      ferpa_compliant: true,
      coppa_compliant: true,
      recording_consent_obtained: false,
      data_retention_date: new Date(Date.now() + 7 * 365 * 24 * 60 * 60 * 1000),
      total_groups: 1,
      total_students: 1,
      end_reason: '',
      teacher_notes: '',
      engagement_score: 0.0,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const student = {
      id: studentId,
      name: studentName,
      grade_level: gradeLevel,
      school_id: 'e2e-test-school',
      email_consent: !isUnderage,
      coppa_compliant: !isUnderage,
      teacher_verified_age: !isUnderage,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const group = {
      id: groupId,
      session_id: sessionId,
      name: 'E2E Test Group',
      group_number: 1,
      status: 'waiting',
      is_ready: false,
      leader_id: isLeader ? studentId : null,
      max_size: 4,
      current_size: 1,
      auto_managed: true,
      created_at: new Date(),
      updated_at: new Date(),
    };

    // Generate a simple mock token for E2E testing (avoiding JWT service complexity)
    const mockToken = `e2e-mock-token-${Date.now()}`;

    logger.debug('✅ E2E mock token generated successfully');

    res.json({
      success: true,
      token: mockToken,
      student,
      session,
      group,
      message: 'E2E test token generated with mock data (simplified for testing)'
    });

  } catch (error) {
    logger.error('❌ Generate student token error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

export default router;

// ---------------------------------------------------------------------------
// Dev observability: Active WebSocket connections (dev-only, gated in prod)
// GET /api/v1/debug/websocket/active-connections
// ---------------------------------------------------------------------------
router.get('/websocket/active-connections', async (req: Request, res: Response) => {
  try {
    const isDev = process.env.NODE_ENV !== 'production';
    if (!isDev) {
      const token = req.header('x-dev-auth');
      const expected = process.env.DEV_OBSERVABILITY_TOKEN;
      if (!token || !expected || token !== expected) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
    }

    const ws = getNamespacedWebSocketService();
    if (!ws) {
      return res.status(503).json({ success: false, error: 'WebSocket service unavailable' });
    }

    const io = ws.getIO();
    const namespaces = ['/sessions', '/guidance'] as const;

    const data: Record<string, any> = {};
    for (const ns of namespaces) {
      const nsp = io.of(ns);
      const sockets = await nsp.fetchSockets();
      const byUser: Record<string, number> = {};
      const list = sockets.map(s => {
        const userId = (s.data && s.data.userId) || 'anonymous';
        byUser[userId] = (byUser[userId] || 0) + 1;
        return { id: s.id, userId, rooms: Array.from(s.rooms ?? []) };
      });

      data[ns] = {
        namespace: ns,
        totalSockets: sockets.length,
        byUser,
        sockets: list,
      };
    }

    return res.json({ success: true, namespaces: data, timestamp: new Date().toISOString() });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'ACTIVE_CONNECTIONS_FAILED' });
  }
});

// ---------------------------------------------------------------------------
// Dev-only: Emit a sample transcript line to a session (teacher UI validation)
// POST /api/v1/debug/sessions/:sessionId/emit-transcription
// Body: { groupId: string, text?: string, confidence?: number, groupName?: string }
// Guard: 
//   - In dev/test: requires header e2e_test_secret = process.env.E2E_TEST_SECRET
//   - In production: requires header x-dev-auth = process.env.DEV_OBSERVABILITY_TOKEN
// ---------------------------------------------------------------------------
router.post('/sessions/:sessionId/emit-transcription', async (req: Request, res: Response) => {
  try {
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd) {
      const token = req.header('x-dev-auth');
      const expected = process.env.DEV_OBSERVABILITY_TOKEN;
      if (!token || !expected || token !== expected) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
    } else {
      const secret = req.header('e2e_test_secret');
      const expected = process.env.E2E_TEST_SECRET || 'test';
      if (!secret || secret !== expected) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
    }

    const paramsSchema = z.object({ sessionId: z.string().min(1) });
    const bodySchema = z.object({
      groupId: z.string().min(1),
      text: z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
      groupName: z.string().optional(),
    });

    const { sessionId } = paramsSchema.parse(req.params);
    const { groupId, text, confidence, groupName } = bodySchema.parse(req.body || {});

    const ws = getNamespacedWebSocketService();
    if (!ws) {
      return res.status(503).json({ success: false, error: 'WEBSOCKET_UNAVAILABLE' });
    }

    // Prepare payload similar to real STT emission
    const payload = {
      id: uuidv4(),
      groupId,
      groupName: groupName || `Group ${groupId}`,
      text: text || 'This is a test transcription line emitted from /debug.',
      timestamp: new Date().toISOString(),
      confidence: typeof confidence === 'number' ? confidence : 0.92,
      language: 'en',
      traceId: `debug-${Date.now().toString(36)}`,
    };

    // Emit to session room so any connected teacher UIs receive it immediately
    ws.getSessionsService().emitToSession(sessionId, 'transcription:group:new', payload);

    return res.json({ success: true, emitted: payload, sessionId });
  } catch (error) {
    return res.status(400).json({ success: false, error: 'INVALID_REQUEST' });
  }
});

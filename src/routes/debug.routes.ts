import { Router, Request, Response, NextFunction } from 'express';
import { databricksService } from '../services/databricks.service';
import { SecureJWTService } from '../services/secure-jwt.service';
import { getNamespacedWebSocketService } from '../services/websocket/namespaced-websocket.service';

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

    console.log('🔧 Generating student token for E2E test:', { sessionCode, studentName, gradeLevel });

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

    console.log('✅ E2E mock token generated successfully');

    res.json({
      success: true,
      token: mockToken,
      student,
      session,
      group,
      message: 'E2E test token generated with mock data (simplified for testing)'
    });

  } catch (error) {
    console.error('❌ Generate student token error:', error);
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

import { Router, Request, Response, NextFunction } from 'express';
import { databricksService } from '../services/databricks.service';
import { SecureJWTService } from '../services/secure-jwt.service';

const router = Router();

// Middleware to protect test-only endpoints
const requireTestSecret = (req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV !== 'test' || req.header('E2E_TEST_SECRET') !== 'test') {
    return res.status(403).json({ success: false, error: 'Forbidden: This endpoint is for testing only.' });
  }
  next();
};

/**
 * Endpoint to generate a student token for E2E testing.
 * Creates a test session, student, group, and group membership.
 *
 * @see /Users/rtaroncher/Documents/SandBoxAI/ClassWaves/checkpoints/WIP/Features/STUDENT_PORTAL_E2E_TESTING_SOW.md
 */
router.post('/generate-student-token', requireTestSecret, async (req, res) => {
  try {
    const { sessionCode, studentName, gradeLevel, isLeader, isUnderage } = req.body;
    if (!sessionCode || !studentName || !gradeLevel) {
      return res.status(400).json({ success: false, error: 'sessionCode, studentName, and gradeLevel are required.' });
    }

    // 1. Find or create the test session
    let session = await databricksService.queryOne('SELECT * FROM classwaves.sessions.classroom_sessions WHERE access_code = ?', [sessionCode]);
    if (!session) {
      const newSession = await databricksService.createSession({
        title: `E2E Test Session ${sessionCode}`,
        description: 'An automated test session.',
        teacherId: 'e2e-test-teacher',
        schoolId: 'e2e-test-school',
        access_code: sessionCode,
        targetGroupSize: 4,
        autoGroupEnabled: true,
        scheduledStart: new Date(),
        plannedDuration: 60,
      });
      session = { id: newSession.sessionId, ...newSession };
    }
    const sessionId = session.id;

    // 2. Create the test student first to get an ID for the leader
    const studentId = databricksService.generateId();
    const student = {
      id: studentId,
      name: studentName,
      grade_level: gradeLevel,
      school_id: 'e2e-test-school',
      email_consent: !isUnderage, // No consent by default if underage
      coppa_compliant: !isUnderage,
      teacher_verified_age: !isUnderage,
      created_at: new Date(),
      updated_at: new Date(),
    };
    await databricksService.insert('students', student);

    // 3. Find or create the test group, now with leader information
    let group = await databricksService.queryOne('SELECT * FROM classwaves.sessions.student_groups WHERE session_id = ? AND name = ?', [sessionId, 'E2E Test Group']);
    const groupId = group ? group.id : databricksService.generateId();

    if (!group) {
        await databricksService.insert('student_groups', {
            id: groupId,
            session_id: sessionId,
            name: 'E2E Test Group',
            group_number: 1,
            status: 'waiting',
            is_ready: false,
            leader_id: isLeader ? studentId : null,
            // Add other required fields with default values
            max_size: 4,
            current_size: 0,
            auto_managed: true,
            created_at: new Date(),
            updated_at: new Date(),
        });
    } else if (isLeader) {
        // If the group exists and we need to set the leader, update it.
        await databricksService.update('student_groups', groupId, { leader_id: studentId });
    }
    group = await databricksService.queryOne('SELECT * FROM classwaves.sessions.student_groups WHERE id = ?', [groupId]);

    // 4. Create the group membership
    await databricksService.insert('student_group_members', {
      id: databricksService.generateId(),
      session_id: sessionId,
      group_id: groupId,
      student_id: studentId,
      created_at: new Date(),
    });

    // 5. Generate the student token
    const token = await SecureJWTService.generateStudentToken(
      studentId,
      sessionId,
      groupId,
      sessionCode
    );

    res.json({
      success: true,
      token,
      student,
      session,
      group,
    });

  } catch (error) {
    console.error('❌ Generate student token error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});


// Test database connection and table access
router.get('/test-db', async (req, res) => {
  try {
    console.log('🔧 Testing database connection...');
    
    // Test basic connection
    const result = await databricksService.query('SELECT 1 as test');
    console.log('✅ Basic query successful:', result);
    
    // Test what tables exist in sessions schema
    const tablesInSchema = await databricksService.query('SHOW TABLES IN classwaves.sessions');
    console.log('✅ Tables in sessions schema:', tablesInSchema);
    
    // Test table access for existing tables only
    const sessionTable = await databricksService.query('DESCRIBE classwaves.sessions.classroom_sessions');
    
    console.log('✅ Session table structure:', sessionTable);
    
    res.json({
      success: true,
      data: {
        basicQuery: result,
        tablesInSchema: tablesInSchema,
        sessionTable: sessionTable
      }
    });
    
  } catch (error) {
    console.error('❌ Database test error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    res.status(500).json({
      success: false,
      error: {
        message: errorMessage,
        stack: errorStack
      }
    });
  }
});

// Test minimal session creation
router.post('/test-session-insert', async (req, res) => {
  try {
    console.log('🔧 Testing minimal session insert...');
    
    const sessionId = `test-${Date.now()}`;
    const accessCode = Math.random().toString(36).slice(2, 8).toUpperCase();
    
    const sessionData = {
      id: sessionId,
      title: 'Debug Test Session',
      description: 'Testing minimal session creation',
      status: 'created',
      scheduled_start: new Date(),
      actual_duration_minutes: 0,
      planned_duration_minutes: 45,
      max_students: 999,
      target_group_size: 4,
      auto_group_enabled: false,
      teacher_id: 'test-teacher-123',
      school_id: 'test-school-456',
      recording_enabled: false,
      transcription_enabled: true,
      ai_analysis_enabled: true,
      ferpa_compliant: true,
      coppa_compliant: true,
      recording_consent_obtained: false,
      data_retention_date: new Date(Date.now() + 7 * 365 * 24 * 60 * 60 * 1000),
      total_groups: 1,
      total_students: 2,
      access_code: accessCode,
      end_reason: '',
      teacher_notes: '',
      engagement_score: 0.0,
      created_at: new Date(),
      updated_at: new Date(),
    };

    console.log('📝 Attempting to insert session with data:', JSON.stringify(sessionData, null, 2));
    
    await databricksService.insert('classroom_sessions', sessionData);
    
    console.log('✅ Session insert successful!');
    
    res.json({
      success: true,
      data: {
        sessionId,
        accessCode,
        message: 'Session created successfully'
      }
    });
    
  } catch (error) {
    console.error('❌ Session insert error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    res.status(500).json({
      success: false,
      error: {
        message: errorMessage,
        stack: errorStack,
        type: typeof error,
        constructor: error?.constructor?.name
      }
    });
  }
});

// Check student_groups table structure
router.get('/check-groups-table', async (req, res) => {
  try {
    const groupsTable = await databricksService.query('DESCRIBE classwaves.sessions.student_groups');
    
    res.json({
      success: true,
      data: {
        groupsTable: groupsTable
      }
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    res.status(500).json({
      success: false,
      error: {
        message: errorMessage,
        stack: errorStack
      }
    });
  }
});

// Test group creation
router.post('/test-group-insert', async (req, res) => {
  try {
    console.log('🔧 Testing group insert...');
    
    const sessionId = `test-session-${Date.now()}`;
    const groupId = `test-group-${Date.now()}`;
    
    const groupData = {
      id: groupId,
      session_id: sessionId,
      name: 'Debug Test Group',
      group_number: 1,
      status: 'created',
      max_size: 4,
      current_size: 2,
      auto_managed: false,
      start_time: new Date(),
      end_time: new Date(),
      total_speaking_time_seconds: 0,
      collaboration_score: 0.0,
      topic_focus_score: 0.0,
      created_at: new Date(),
      updated_at: new Date(),
      leader_id: 'test-leader-123',
      is_ready: false,
      topical_cohesion: 0.0,
      argumentation_quality: 0.0,
      sentiment_arc: '[]',
      conceptual_density: 0.0,
    };

    console.log('📝 Attempting to insert group with data:', JSON.stringify(groupData, null, 2));
    
    await databricksService.insert('student_groups', groupData);
    
    console.log('✅ Group insert successful!');
    
    res.json({
      success: true,
      data: {
        groupId,
        message: 'Group created successfully'
      }
    });
    
  } catch (error) {
    console.error('❌ Group insert error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    res.status(500).json({
      success: false,
      error: {
        message: errorMessage,
        stack: errorStack,
        type: typeof error,
        constructor: error?.constructor?.name
      }
    });
  }
});

// Check session_analytics table structure
router.get('/check-analytics-table', async (req, res) => {
  try {
    const analyticsTable = await databricksService.query('DESCRIBE classwaves.sessions.session_analytics');
    
    res.json({
      success: true,
      data: {
        analyticsTable: analyticsTable
      }
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    res.status(500).json({
      success: false,
      error: {
        message: errorMessage,
        stack: errorStack
      }
    });
  }
});

// Check what schemas exist in the catalog
router.get('/check-schemas', async (req, res) => {
  try {
    const schemas = await databricksService.query('SHOW SCHEMAS IN classwaves');
    
    res.json({
      success: true,
      data: {
        schemas: schemas
      }
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    res.status(500).json({
      success: false,
      error: {
        message: errorMessage,
        stack: errorStack
      }
    });
  }
});

// Check what tables exist in analytics schema
router.get('/check-analytics-schema', async (req, res) => {
  try {
    const tables = await databricksService.query('SHOW TABLES IN classwaves.analytics');
    
    res.json({
      success: true,
      data: {
        analyticsSchemaTable: tables
      }
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    res.status(500).json({
      success: false,
      error: {
        message: errorMessage,
        stack: errorStack
      }
    });
  }
});

// Check session_metrics table structure
router.get('/check-session-metrics', async (req, res) => {
  try {
    const sessionMetrics = await databricksService.query('DESCRIBE classwaves.analytics.session_metrics');
    
    res.json({
      success: true,
      data: {
        sessionMetrics: sessionMetrics
      }
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    res.status(500).json({
      success: false,
      error: {
        message: errorMessage,
        stack: errorStack
      }
    });
  }
});

// Create missing student_group_members table
router.post('/create-student-group-members-table', async (req, res) => {
  try {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS classwaves.sessions.student_group_members (
        id STRING NOT NULL,
        session_id STRING NOT NULL,
        group_id STRING NOT NULL,
        student_id STRING NOT NULL,
        created_at TIMESTAMP NOT NULL,
        PRIMARY KEY (id)
      ) USING DELTA
      TBLPROPERTIES (
        'delta.columnMapping.mode' = 'name',
        'delta.minReaderVersion' = '2',
        'delta.minWriterVersion' = '5'
      )
    `;
    
    console.log('🔧 Creating student_group_members table...');
    await databricksService.query(createTableSQL);
    
    console.log('✅ student_group_members table created successfully!');
    
    res.json({
      success: true,
      data: {
        message: 'student_group_members table created successfully',
        sql: createTableSQL
      }
    });
    
  } catch (error) {
    console.error('❌ Failed to create student_group_members table:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    res.status(500).json({
      success: false,
      error: {
        message: errorMessage,
        stack: errorStack
      }
    });
  }
});

// Test membership analytics directly
router.get('/test-membership-analytics/:sessionId', async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    
    console.log('🔧 Testing membership analytics for session:', sessionId);
    
    // Test basic group data
    const groups = await databricksService.query(`
      SELECT 
        sg.id,
        sg.name,
        sg.leader_id,
        sg.current_size,
        COUNT(sgm.student_id) as actual_member_count,
        COUNT(CASE WHEN sg.leader_id = sgm.student_id THEN 1 END) as leader_present,
        COUNT(CASE WHEN sg.leader_id != sgm.student_id THEN 1 END) as regular_members_count
      FROM classwaves.sessions.student_groups sg
      LEFT JOIN classwaves.sessions.student_group_members sgm ON sg.id = sgm.group_id
      WHERE sg.session_id = ?
      GROUP BY sg.id, sg.name, sg.leader_id, sg.current_size, sg.group_number
      ORDER BY sg.group_number
    `, [sessionId]);
    
    console.log('✅ Group data retrieved:', groups);
    
    // Test membership data
    const membershipData = await databricksService.query(`
      SELECT 
        sgm.group_id,
        sgm.student_id,
        sgm.created_at
      FROM classwaves.sessions.student_group_members sgm
      INNER JOIN classwaves.sessions.student_groups sg ON sgm.group_id = sg.id
      WHERE sg.session_id = ?
      ORDER BY sgm.created_at
    `, [sessionId]);
    
    console.log('✅ Membership data retrieved:', membershipData);
    
    res.json({
      success: true,
      data: {
        sessionId,
        groups: groups,
        memberships: membershipData,
        analytics: {
          totalGroups: groups.length,
          totalMembers: membershipData.length,
          groupsWithLeaders: groups.filter((g: any) => g.leader_present > 0).length,
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Membership analytics test error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    res.status(500).json({
      success: false,
      error: {
        message: errorMessage,
        stack: errorStack
      }
    });
  }
});

export default router;

import { Router } from 'express';
import { databricksService } from '../services/databricks.service';

const router = Router();

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

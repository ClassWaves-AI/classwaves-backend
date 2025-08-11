import { databricksService } from '../services/databricks.service';
import { databricksConfig } from '../config/databricks.config';
import dotenv from 'dotenv';

dotenv.config();

async function testSessionCreation() {
  try {
    console.log('🧪 Testing session creation with updated schema...');
    
    await databricksService.connect();
    console.log('✅ Connected to Databricks');
    
    // Test creating a session - this should now work without the 500 error
    const sessionData = {
      title: 'E2E Test Session',
      description: 'Testing session creation after schema fix',
      teacherId: 'teacher-test-123',
      schoolId: 'school-test-123',
      maxStudents: 30,
      targetGroupSize: 4,
      plannedDuration: 45,
      autoGroupEnabled: true,
      scheduledStart: new Date(Date.now() + 60000), // 1 minute from now
    };
    
    const session = await databricksService.createSession(sessionData);
    console.log('🎉 Session created successfully!');
    console.log('📋 Session details:');
    console.log('   Session ID:', session.sessionId);
    console.log('   Access Code:', session.accessCode);
    console.log('   Created At:', session.createdAt);
    
    // Verify the session was inserted correctly by querying it back
    const retrievedSession = await databricksService.queryOne(
      `SELECT * FROM ${databricksConfig.catalog}.sessions.classroom_sessions WHERE id = ?`,
      [session.sessionId]
    );
    
    if (retrievedSession) {
      console.log('✅ Session retrieval successful');
      console.log('   Has access_code:', !!retrievedSession.access_code);
      console.log('   Has engagement_score:', typeof retrievedSession.engagement_score !== 'undefined');
      console.log('   No participation_rate:', typeof retrievedSession.participation_rate === 'undefined');
      console.log('   Title:', retrievedSession.title);
      console.log('   Description:', retrievedSession.description);
    } else {
      console.log('❌ Could not retrieve session');
    }
    
  } catch (error: any) {
    console.error('❌ Error testing session creation:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack.split('\n').slice(0, 5).join('\n'));
    }
  }
  
  process.exit(0);
}

testSessionCreation();

import { databricksService } from '../services/databricks.service';
import { databricksConfig } from '../config/databricks.config';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

async function testSessionCreation() {
  try {
    logger.debug('🧪 Testing session creation with updated schema...');
    
    await databricksService.connect();
    logger.debug('✅ Connected to Databricks');
    
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
    logger.debug('🎉 Session created successfully!');
    logger.debug('📋 Session details:');
    logger.debug('   Session ID:', session.sessionId);
    logger.debug('   Access Code:', session.accessCode);
    logger.debug('   Created At:', session.createdAt);
    
    // Verify the session was inserted correctly by querying it back
    const retrievedSession = await databricksService.queryOne(
      `SELECT * FROM ${databricksConfig.catalog}.sessions.classroom_sessions WHERE id = ?`,
      [session.sessionId]
    );
    
    if (retrievedSession) {
      logger.debug('✅ Session retrieval successful');
      logger.debug('   Has access_code:', !!retrievedSession.access_code);
      logger.debug('   Has engagement_score:', typeof retrievedSession.engagement_score !== 'undefined');
      logger.debug('   No participation_rate:', typeof retrievedSession.participation_rate === 'undefined');
      logger.debug('   Title:', retrievedSession.title);
      logger.debug('   Description:', retrievedSession.description);
    } else {
      logger.debug('❌ Could not retrieve session');
    }
    
  } catch (error: any) {
    logger.error('❌ Error testing session creation:', error.message);
    if (error.stack) {
      logger.error('Stack trace:', error.stack.split('\n').slice(0, 5).join('\n'));
    }
  }
  
  process.exit(0);
}

testSessionCreation();
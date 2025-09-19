import { databricksService } from '../services/databricks.service';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

async function testWorkspaceTables() {
  logger.debug('🔍 Testing workspace.default tables access...\n');
  
  try {
    await databricksService.connect();
    logger.debug('✅ Connected to Databricks\n');
    
    // Test direct queries
    logger.debug('📋 Testing table access:\n');
    
    // Test schools table
    logger.debug('1. Schools table:');
    try {
      const schools = await databricksService.query('SELECT COUNT(*) as count FROM schools');
      logger.debug(`   ✅ Direct query works: ${schools[0].count} schools`);
      
      const demoSchool = await databricksService.queryOne(
        "SELECT * FROM schools WHERE domain = ?",
        ['demo.classwaves.com']
      );
      if (demoSchool) {
        logger.debug(`   ✅ Demo school found: ${demoSchool.name}`);
      }
    } catch (error: any) {
      logger.debug(`   ❌ Error: ${error.message}`);
    }
    
    // Test teachers table
    logger.debug('\n2. Teachers table:');
    try {
      const teachers = await databricksService.query('SELECT COUNT(*) as count FROM teachers');
      logger.debug(`   ✅ Direct query works: ${teachers[0].count} teachers`);
      
      const demoTeacher = await databricksService.queryOne(
        "SELECT * FROM teachers WHERE email = ?",
        ['teacher@demo.classwaves.com']
      );
      if (demoTeacher) {
        logger.debug(`   ✅ Demo teacher found: ${demoTeacher.name}`);
      }
    } catch (error: any) {
      logger.debug(`   ❌ Error: ${error.message}`);
    }
    
    // Test service methods
    logger.debug('\n📋 Testing service methods:\n');
    
    // Test getSchoolByDomain
    logger.debug('3. getSchoolByDomain:');
    try {
      const school = await databricksService.getSchoolByDomain('demo.classwaves.com');
      if (school) {
        logger.debug(`   ✅ Works: ${school.name} (${school.subscription_tier})`);
      } else {
        logger.debug('   ❌ No school found');
      }
    } catch (error: any) {
      logger.debug(`   ❌ Error: ${error.message}`);
    }
    
    // Test getTeacherByEmail
    logger.debug('\n4. getTeacherByEmail:');
    try {
      const teacher = await databricksService.getTeacherByEmail('teacher@demo.classwaves.com');
      if (teacher) {
        logger.debug(`   ✅ Works: ${teacher.name} (${teacher.role})`);
      } else {
        logger.debug('   ❌ No teacher found');
      }
    } catch (error: any) {
      logger.debug(`   ❌ Error: ${error.message}`);
    }
    
    // Test creating a session
    logger.debug('\n5. Creating test session:');
    try {
      const sessionId = await databricksService.createSession({
        title: 'Test Session',
        description: 'Testing database connection',
        teacherId: 'tch_demo_001',
        schoolId: 'sch_demo_001',
        maxStudents: 30,
        targetGroupSize: 4,
        autoGroupEnabled: true,
        plannedDuration: 45
      });
      logger.debug(`   ✅ Session created with ID: ${sessionId}`);
      
      // Verify it exists
      const session = await databricksService.queryOne(
        'SELECT * FROM sessions WHERE id = ?',
        [sessionId]
      );
      if (session) {
        logger.debug(`   ✅ Session verified: ${session.title}`);
      }
    } catch (error: any) {
      logger.debug(`   ❌ Error: ${error.message}`);
    }
    
    logger.debug('\n✨ All tests completed!');
    
  } catch (error) {
    logger.error('❌ Fatal error:', error);
  } finally {
    await databricksService.disconnect();
    logger.debug('\n👋 Disconnected from Databricks');
  }
}

if (require.main === module) {
  testWorkspaceTables().catch(console.error);
}

export { testWorkspaceTables };
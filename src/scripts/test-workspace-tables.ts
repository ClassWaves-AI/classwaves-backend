import { databricksService } from '../services/databricks.service';
import dotenv from 'dotenv';

dotenv.config();

async function testWorkspaceTables() {
  console.log('🔍 Testing workspace.default tables access...\n');
  
  try {
    await databricksService.connect();
    console.log('✅ Connected to Databricks\n');
    
    // Test direct queries
    console.log('📋 Testing table access:\n');
    
    // Test schools table
    console.log('1. Schools table:');
    try {
      const schools = await databricksService.query('SELECT COUNT(*) as count FROM schools');
      console.log(`   ✅ Direct query works: ${schools[0].count} schools`);
      
      const demoSchool = await databricksService.queryOne(
        "SELECT * FROM schools WHERE domain = ?",
        ['demo.classwaves.com']
      );
      if (demoSchool) {
        console.log(`   ✅ Demo school found: ${demoSchool.name}`);
      }
    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
    }
    
    // Test teachers table
    console.log('\n2. Teachers table:');
    try {
      const teachers = await databricksService.query('SELECT COUNT(*) as count FROM teachers');
      console.log(`   ✅ Direct query works: ${teachers[0].count} teachers`);
      
      const demoTeacher = await databricksService.queryOne(
        "SELECT * FROM teachers WHERE email = ?",
        ['teacher@demo.classwaves.com']
      );
      if (demoTeacher) {
        console.log(`   ✅ Demo teacher found: ${demoTeacher.name}`);
      }
    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
    }
    
    // Test service methods
    console.log('\n📋 Testing service methods:\n');
    
    // Test getSchoolByDomain
    console.log('3. getSchoolByDomain:');
    try {
      const school = await databricksService.getSchoolByDomain('demo.classwaves.com');
      if (school) {
        console.log(`   ✅ Works: ${school.name} (${school.subscription_tier})`);
      } else {
        console.log('   ❌ No school found');
      }
    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
    }
    
    // Test getTeacherByEmail
    console.log('\n4. getTeacherByEmail:');
    try {
      const teacher = await databricksService.getTeacherByEmail('teacher@demo.classwaves.com');
      if (teacher) {
        console.log(`   ✅ Works: ${teacher.name} (${teacher.role})`);
      } else {
        console.log('   ❌ No teacher found');
      }
    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
    }
    
    // Test creating a session
    console.log('\n5. Creating test session:');
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
      console.log(`   ✅ Session created with ID: ${sessionId}`);
      
      // Verify it exists
      const session = await databricksService.queryOne(
        'SELECT * FROM sessions WHERE id = ?',
        [sessionId]
      );
      if (session) {
        console.log(`   ✅ Session verified: ${session.title}`);
      }
    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
    }
    
    console.log('\n✨ All tests completed!');
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
  } finally {
    await databricksService.disconnect();
    console.log('\n👋 Disconnected from Databricks');
  }
}

if (require.main === module) {
  testWorkspaceTables().catch(console.error);
}

export { testWorkspaceTables };
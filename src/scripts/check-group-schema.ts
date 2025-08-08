import { config } from 'dotenv';
import { join } from 'path';

// Load environment variables
config({ path: join(__dirname, '../../.env') });

async function checkGroupSchema() {
  try {
    console.log('🔍 Checking group table schemas...');
    
    const host = process.env.DATABRICKS_HOST;
    const token = process.env.DATABRICKS_TOKEN;
    const warehouse = process.env.DATABRICKS_WAREHOUSE_ID;
    
    if (!host || !token || !warehouse) {
      throw new Error('Missing required Databricks environment variables');
    }
    
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
    
    // Function to execute SQL statement
    async function executeSQL(sql: string, description: string) {
      console.log(`\n📝 ${description}...`);
      
      const response = await fetch(`${host}/api/2.0/sql/statements`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          warehouse_id: warehouse,
          statement: sql,
          wait_timeout: '30s'
        })
      });
      
      if (!response.ok) {
        const error = await response.text();
        console.error(`❌ Failed to ${description}:`, response.status, error);
        return null;
      }
      
      const result = await response.json() as any;
      return result;
    }
    
    // Check student_groups table schema
    console.log('\n=== STUDENT_GROUPS TABLE SCHEMA ===');
    const groupsSchema = await executeSQL(
      'DESCRIBE classwaves.sessions.student_groups',
      'Get student_groups schema'
    );
    
    if (groupsSchema?.result?.data_array) {
      console.log('\nColumns in student_groups table:');
      groupsSchema.result.data_array.forEach((row: any[], index: number) => {
        console.log(`${index + 1}. ${row[0]} (${row[1]}) ${row[2] ? '- ' + row[2] : ''}`);
      });
    }
    
    // Check participants table schema
    console.log('\n=== PARTICIPANTS TABLE SCHEMA ===');
    const participantsSchema = await executeSQL(
      'DESCRIBE classwaves.sessions.participants',
      'Get participants schema'
    );
    
    if (participantsSchema?.result?.data_array) {
      console.log('\nColumns in participants table:');
      participantsSchema.result.data_array.forEach((row: any[], index: number) => {
        console.log(`${index + 1}. ${row[0]} (${row[1]}) ${row[2] ? '- ' + row[2] : ''}`);
      });
    }
    
    // Check if tables have data
    console.log('\n=== TABLE ROW COUNTS ===');
    const groupCount = await executeSQL(
      'SELECT COUNT(*) as count FROM classwaves.sessions.student_groups',
      'Count groups'
    );
    
    const participantCount = await executeSQL(
      'SELECT COUNT(*) as count FROM classwaves.sessions.participants',
      'Count participants'
    );
    
    if (groupCount?.result?.data_array?.[0]?.[0] !== undefined) {
      console.log(`Groups: ${groupCount.result.data_array[0][0]}`);
    }
    
    if (participantCount?.result?.data_array?.[0]?.[0] !== undefined) {
      console.log(`Participants: ${participantCount.result.data_array[0][0]}`);
    }
    
  } catch (error) {
    console.error('❌ Error checking schema:', error);
  }
}

if (require.main === module) {
  checkGroupSchema();
}

export { checkGroupSchema };

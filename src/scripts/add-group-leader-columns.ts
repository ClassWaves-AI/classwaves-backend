import { config } from 'dotenv';
import { join } from 'path';

// Load environment variables
config({ path: join(__dirname, '../../.env') });

async function addGroupLeaderColumns() {
  try {
    console.log('🔧 Adding group leader tracking columns to database...');
    
    const host = process.env.DATABRICKS_HOST;
    const token = process.env.DATABRICKS_TOKEN;
    const warehouse = process.env.DATABRICKS_WAREHOUSE_ID;
    
    if (!host || !token || !warehouse) {
      throw new Error('Missing required Databricks environment variables');
    }
    
    console.log('Databricks config:', {
      host: host ? 'Set' : 'Missing',
      token: token ? 'Set' : 'Missing',
      warehouse: warehouse ? 'Set' : 'Missing'
    });
    
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
    
    // Function to execute SQL statement
    async function executeSQL(sql: string, description: string) {
      console.log(`\n📝 ${description}...`);
      console.log(`SQL: ${sql}`);
      
      const response = await fetch(`${host}/api/2.0/sql/statements`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          warehouse_id: warehouse,
          statement: sql,
          wait_timeout: '50s'
        })
      });
      
      if (!response.ok) {
        const error = await response.text();
        console.error(`❌ Failed to ${description}:`, response.status, error);
        return false;
      }
      
      const result = await response.json();
      console.log(`✅ ${description} completed successfully`);
      return true;
    }
    
    // Add leader_id column to student_groups table
    const addLeaderIdSQL = `
      ALTER TABLE classwaves.sessions.student_groups 
      ADD COLUMN leader_id STRING
    `;
    
    // Add is_ready column to student_groups table (if it doesn't exist)
    const addIsReadySQL = `
      ALTER TABLE classwaves.sessions.student_groups 
      ADD COLUMN is_ready BOOLEAN DEFAULT FALSE
    `;
    
    // Add is_group_leader column to participants table
    const addIsGroupLeaderSQL = `
      ALTER TABLE classwaves.sessions.participants 
      ADD COLUMN is_group_leader BOOLEAN DEFAULT FALSE
    `;
    
    // Execute the schema updates
    const alterations = [
      { sql: addLeaderIdSQL, description: 'Add leader_id column to student_groups' },
      { sql: addIsReadySQL, description: 'Add is_ready column to student_groups' },
      { sql: addIsGroupLeaderSQL, description: 'Add is_group_leader column to participants' }
    ];
    
    let successCount = 0;
    
    for (const alteration of alterations) {
      const success = await executeSQL(alteration.sql, alteration.description);
      if (success) {
        successCount++;
      } else {
        console.log(`⚠️ Column might already exist for: ${alteration.description}`);
      }
    }
    
    console.log(`\n🎉 Schema update complete! ${successCount}/${alterations.length} alterations processed.`);
    
    // Verify the schema changes
    console.log('\n🔍 Verifying schema changes...');
    
    const verifyGroupsSQL = `DESCRIBE classwaves.sessions.student_groups`;
    const verifyParticipantsSQL = `DESCRIBE classwaves.sessions.participants`;
    
    await executeSQL(verifyGroupsSQL, 'Verify student_groups schema');
    await executeSQL(verifyParticipantsSQL, 'Verify participants schema');
    
  } catch (error) {
    console.error('❌ Error updating schema:', error);
  }
}

if (require.main === module) {
  addGroupLeaderColumns();
}

export { addGroupLeaderColumns };

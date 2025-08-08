import { config } from 'dotenv';
import { join } from 'path';

// Load environment variables
config({ path: join(__dirname, '../../.env') });

async function addIsReadyColumn() {
  try {
    console.log('🔧 Adding is_ready column to student_groups table...');
    
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
      console.log(`SQL: ${sql}`);
      
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
        return false;
      }
      
      const result = await response.json();
      console.log(`✅ ${description} completed successfully`);
      return true;
    }
    
    // Add is_ready column to student_groups table
    const addIsReadySQL = `
      ALTER TABLE classwaves.sessions.student_groups 
      ADD COLUMN is_ready BOOLEAN DEFAULT FALSE
    `;
    
    const success = await executeSQL(addIsReadySQL, 'Add is_ready column to student_groups');
    
    if (success) {
      console.log('\n🎉 is_ready column added successfully!');
      
      // Verify the column was added
      console.log('\n🔍 Verifying column was added...');
      const verifySQL = 'DESCRIBE classwaves.sessions.student_groups';
      await executeSQL(verifySQL, 'Verify student_groups schema');
    } else {
      console.log('\n⚠️ Column might already exist');
    }
    
  } catch (error) {
    console.error('❌ Error adding column:', error);
  }
}

if (require.main === module) {
  addIsReadyColumn();
}

export { addIsReadyColumn };

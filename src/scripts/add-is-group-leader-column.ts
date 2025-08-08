import { config } from 'dotenv';
import { join } from 'path';

// Load environment variables
config({ path: join(__dirname, '../../.env') });

async function addIsGroupLeaderColumn() {
  try {
    console.log('🔧 Adding is_group_leader column to participants table...');
    
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
    
    // Add is_group_leader column to participants table
    const addIsGroupLeaderSQL = `
      ALTER TABLE classwaves.sessions.participants 
      ADD COLUMN is_group_leader BOOLEAN DEFAULT FALSE
    `;
    
    const success = await executeSQL(addIsGroupLeaderSQL, 'Add is_group_leader column to participants');
    
    if (success) {
      console.log('\n🎉 is_group_leader column added successfully!');
      
      // Verify the column was added
      console.log('\n🔍 Verifying column was added...');
      const verifySQL = 'DESCRIBE classwaves.sessions.participants';
      await executeSQL(verifySQL, 'Verify participants schema');
    } else {
      console.log('\n⚠️ Column might already exist');
    }
    
  } catch (error) {
    console.error('❌ Error adding column:', error);
  }
}

if (require.main === module) {
  addIsGroupLeaderColumn();
}

export { addIsGroupLeaderColumn };

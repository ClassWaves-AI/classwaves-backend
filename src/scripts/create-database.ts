import { databricksService } from '../services/databricks.service';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function createDatabase() {
  console.log('🚀 Starting ClassWaves database creation...\n');
  
  try {
    // Connect to Databricks
    console.log('📡 Connecting to Databricks...');
    await databricksService.connect();
    console.log('✅ Connected successfully!\n');
    
    // Read the SQL script
    const sqlPath = path.join(__dirname, '../../create-databricks-schema-fixed.sql');
    const sqlScript = fs.readFileSync(sqlPath, 'utf-8');
    
    // Split the script into individual statements
    // First remove multi-line comments
    const cleanedScript = sqlScript.replace(/\/\*[\s\S]*?\*\//g, '');
    
    // Then remove single-line comments
    const lines = cleanedScript.split('\n');
    const nonCommentLines = lines.filter(line => !line.trim().startsWith('--'));
    const scriptWithoutComments = nonCommentLines.join('\n');
    
    // Split by semicolon and clean up
    const statements = scriptWithoutComments
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt && stmt.length > 5) // Filter out empty or tiny statements
      .map(stmt => stmt + ';');
    
    console.log(`📋 Found ${statements.length} SQL statements to execute\n`);
    
    // Track progress
    let successCount = 0;
    let errorCount = 0;
    const errors: { statement: string; error: any }[] = [];
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      // Skip empty statements
      if (!statement.trim() || statement.trim() === ';') {
        continue;
      }
      
      // Extract operation type and target
      const operationMatch = statement.match(/^(CREATE|INSERT|OPTIMIZE|ANALYZE|USE)\s+(CATALOG|SCHEMA|TABLE|INTO)?\s*(?:IF\s+NOT\s+EXISTS\s+)?(\w+)?/i);
      const operation = operationMatch ? `${operationMatch[1]} ${operationMatch[2] || ''} ${operationMatch[3] || ''}`.trim() : 'Statement';
      
      process.stdout.write(`[${i + 1}/${statements.length}] Executing ${operation}... `);
      
      try {
        await databricksService.query(statement);
        successCount++;
        console.log('✅');
      } catch (error: any) {
        errorCount++;
        console.log('❌');
        errors.push({ statement: statement.substring(0, 100) + '...', error });
        
        // Continue on error for CREATE IF NOT EXISTS statements
        if (statement.includes('IF NOT EXISTS')) {
          console.log('   ⚠️  Warning: ' + (error.message || error));
        } else {
          console.log('   ❌ Error: ' + (error.message || error));
        }
      }
    }
    
    // Summary
    console.log('\n📊 Database Creation Summary:');
    console.log(`   ✅ Successful statements: ${successCount}`);
    console.log(`   ❌ Failed statements: ${errorCount}`);
    
    if (errors.length > 0) {
      console.log('\n⚠️  Errors encountered:');
      errors.forEach((err, idx) => {
        console.log(`\n   ${idx + 1}. Statement: ${err.statement}`);
        console.log(`      Error: ${err.error.message || err.error}`);
      });
    }
    
    // Verify critical tables
    console.log('\n🔍 Verifying critical tables...');
    const criticalTables = ['schools', 'teachers', 'sessions', 'groups', 'student_participants', 'audit_log'];
    
    for (const table of criticalTables) {
      try {
        const result = await databricksService.query(`SELECT COUNT(*) as count FROM classwaves.main.${table} LIMIT 1`);
        console.log(`   ✅ Table '${table}' exists`);
      } catch (error) {
        console.log(`   ❌ Table '${table}' not found`);
      }
    }
    
    // Check if admin data was inserted
    console.log('\n🔍 Checking admin setup...');
    try {
      const adminSchool = await databricksService.queryOne(
        'SELECT * FROM classwaves.main.schools WHERE domain = ?',
        ['classwaves.ai']
      );
      if (adminSchool) {
        console.log('   ✅ Admin school created successfully');
      }
      
      const adminUser = await databricksService.queryOne(
        'SELECT * FROM classwaves.main.teachers WHERE email = ?',
        ['rob@classwaves.ai']
      );
      if (adminUser) {
        console.log('   ✅ Admin user created successfully');
      }
    } catch (error) {
      console.log('   ⚠️  Could not verify admin setup');
    }
    
    console.log('\n✨ Database creation process completed!');
    
  } catch (error) {
    console.error('\n❌ Fatal error during database creation:', error);
    process.exit(1);
  } finally {
    await databricksService.disconnect();
    console.log('\n👋 Disconnected from Databricks');
  }
}

// Run the script
if (require.main === module) {
  createDatabase().catch(console.error);
}

export { createDatabase };
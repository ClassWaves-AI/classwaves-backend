import { databricksService } from '../services/databricks.service';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

async function createCatalogStructure() {
  console.log('🚀 Creating ClassWaves Databricks Catalog Structure...\n');
  console.log('Structure: Catalog → Schema → Tables\n');
  
  try {
    await databricksService.connect();
    console.log('✅ Connected to Databricks\n');
    
    // Read the SQL script
    const sqlPath = path.join(__dirname, '../../databricks-catalog-structure.sql');
    const sqlScript = fs.readFileSync(sqlPath, 'utf-8');
    
    // Parse SQL statements
    const statements = sqlScript
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => {
        const cleaned = stmt.replace(/--.*$/gm, '').trim();
        return cleaned && cleaned.length > 5 && !cleaned.startsWith('--');
      })
      .map(stmt => stmt + ';');
    
    console.log(`📋 Found ${statements.length} SQL statements to execute\n`);
    
    // Track progress by operation type
    const operations = {
      'DROP CATALOG': 0,
      'CREATE CATALOG': 0,
      'CREATE SCHEMA': 0,
      'CREATE TABLE': 0,
      'ALTER TABLE': 0,
      'INSERT': 0,
      'USE': 0,
      'SELECT': 0
    };
    
    let successCount = 0;
    let errorCount = 0;
    const errors: { statement: string; error: any }[] = [];
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      if (!statement.trim() || statement.trim() === ';') {
        continue;
      }
      
      // Identify operation type
      const operationType = Object.keys(operations).find(op => 
        statement.toUpperCase().trim().startsWith(op)
      ) || 'OTHER';
      
      // Extract target name for better logging
      let target = '';
      if (statement.includes('CATALOG')) {
        const match = statement.match(/CATALOG\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i);
        target = match ? ` ${match[1]}` : '';
      } else if (statement.includes('SCHEMA')) {
        const match = statement.match(/SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i);
        target = match ? ` ${match[1]}` : '';
      } else if (statement.includes('TABLE')) {
        const match = statement.match(/TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+\.)?(\w+)/i);
        target = match ? ` ${match[2]}` : '';
      }
      
      process.stdout.write(`[${i + 1}/${statements.length}] ${operationType}${target}... `);
      
      try {
        await databricksService.query(statement);
        successCount++;
        if (operationType in operations) {
          operations[operationType as keyof typeof operations]++;
        }
        console.log('✅');
      } catch (error: any) {
        errorCount++;
        console.log('❌');
        
        // Log specific error types
        if (error.message?.includes('already exists')) {
          console.log('   ℹ️  Already exists');
        } else if (error.message?.includes('CASCADE')) {
          console.log('   ℹ️  Cascade operation');
        } else {
          console.log(`   ❌ Error: ${error.message || error}`);
          errors.push({ statement: statement.substring(0, 100) + '...', error });
        }
      }
    }
    
    // Summary
    console.log('\n📊 Execution Summary:');
    console.log(`   ✅ Successful statements: ${successCount}`);
    console.log(`   ❌ Failed statements: ${errorCount}`);
    
    console.log('\n📈 Operations breakdown:');
    Object.entries(operations).forEach(([op, count]) => {
      if (count > 0) {
        console.log(`   - ${op}: ${count}`);
      }
    });
    
    // Verify the structure
    console.log('\n🔍 Verifying catalog structure...\n');
    
    try {
      // Check catalog
      await databricksService.query('USE CATALOG classwaves');
      console.log('✅ Catalog "classwaves" is active');
      
      // List schemas
      const schemas = await databricksService.query('SHOW SCHEMAS');
      console.log(`\n📁 Schemas created (${schemas.length}):`);
      const expectedSchemas = ['users', 'sessions', 'analytics', 'compliance', 'ai_insights', 'operational'];
      
      expectedSchemas.forEach(schemaName => {
        const found = schemas.some((s: any) => 
          (s.schema_name || s.database_name || s.namespace || '').toLowerCase() === schemaName
        );
        console.log(`   - ${schemaName}: ${found ? '✅' : '❌'}`);
      });
      
      // Check key tables in each schema
      console.log('\n📋 Verifying key tables:');
      
      const keyTables = [
        { schema: 'users', tables: ['schools', 'teachers', 'students'] },
        { schema: 'sessions', tables: ['classroom_sessions', 'student_groups', 'participants'] },
        { schema: 'analytics', tables: ['session_metrics', 'group_metrics', 'student_metrics'] },
        { schema: 'compliance', tables: ['audit_log', 'parental_consents', 'coppa_compliance'] },
        { schema: 'ai_insights', tables: ['analysis_results', 'intervention_suggestions'] },
        { schema: 'operational', tables: ['system_events', 'api_metrics'] }
      ];
      
      for (const { schema, tables } of keyTables) {
        console.log(`\n   ${schema} schema:`);
        for (const table of tables) {
          try {
            await databricksService.query(`SELECT 1 FROM classwaves.${schema}.${table} LIMIT 1`);
            console.log(`     - ${table}: ✅`);
          } catch (error) {
            console.log(`     - ${table}: ❌`);
          }
        }
      }
      
      // Check demo data
      console.log('\n🧪 Checking demo data:');
      try {
        const demoSchool = await databricksService.queryOne(
          'SELECT * FROM classwaves.users.schools WHERE domain = ?',
          ['demo.classwaves.com']
        );
        if (demoSchool) {
          console.log('   ✅ Demo school created');
        }
        
        const demoTeacher = await databricksService.queryOne(
          'SELECT * FROM classwaves.users.teachers WHERE email = ?',
          ['teacher@demo.classwaves.com']
        );
        if (demoTeacher) {
          console.log('   ✅ Demo teacher created');
        }
      } catch (error) {
        console.log('   ❌ Could not verify demo data');
      }
      
    } catch (error: any) {
      console.log('❌ Could not verify structure:', error.message);
    }
    
    console.log('\n✨ Catalog structure creation completed!');
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    throw error;
  } finally {
    await databricksService.disconnect();
    console.log('\n👋 Disconnected from Databricks');
  }
}

if (require.main === module) {
  createCatalogStructure().catch(console.error);
}

export { createCatalogStructure };
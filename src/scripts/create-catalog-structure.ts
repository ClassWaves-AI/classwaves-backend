import { databricksService } from '../services/databricks.service';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

async function createCatalogStructure() {
  logger.debug('🚀 Creating ClassWaves Databricks Catalog Structure...\n');
  logger.debug('Structure: Catalog → Schema → Tables\n');
  
  try {
    await databricksService.connect();
    logger.debug('✅ Connected to Databricks\n');
    
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
    
    logger.debug(`📋 Found ${statements.length} SQL statements to execute\n`);
    
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
        logger.debug('✅');
      } catch (error: any) {
        errorCount++;
        logger.debug('❌');
        
        // Log specific error types
        if (error.message?.includes('already exists')) {
          logger.debug('   ℹ️  Already exists');
        } else if (error.message?.includes('CASCADE')) {
          logger.debug('   ℹ️  Cascade operation');
        } else {
          logger.debug(`   ❌ Error: ${error.message || error}`);
          errors.push({ statement: statement.substring(0, 100) + '...', error });
        }
      }
    }
    
    // Summary
    logger.debug('\n📊 Execution Summary:');
    logger.debug(`   ✅ Successful statements: ${successCount}`);
    logger.debug(`   ❌ Failed statements: ${errorCount}`);
    
    logger.debug('\n📈 Operations breakdown:');
    Object.entries(operations).forEach(([op, count]) => {
      if (count > 0) {
        logger.debug(`   - ${op}: ${count}`);
      }
    });
    
    // Verify the structure
    logger.debug('\n🔍 Verifying catalog structure...\n');
    
    try {
      // Check catalog
      await databricksService.query('USE CATALOG classwaves');
      logger.debug('✅ Catalog "classwaves" is active');
      
      // List schemas
      const schemas = await databricksService.query('SHOW SCHEMAS');
      logger.debug(`\n📁 Schemas created (${schemas.length}):`);
      const expectedSchemas = ['users', 'sessions', 'analytics', 'compliance', 'ai_insights', 'operational'];
      
      expectedSchemas.forEach(schemaName => {
        const found = schemas.some((s: any) => 
          (s.schema_name || s.database_name || s.namespace || '').toLowerCase() === schemaName
        );
        logger.debug(`   - ${schemaName}: ${found ? '✅' : '❌'}`);
      });
      
      // Check key tables in each schema
      logger.debug('\n📋 Verifying key tables:');
      
      const keyTables = [
        { schema: 'users', tables: ['schools', 'teachers', 'students'] },
        { schema: 'sessions', tables: ['classroom_sessions', 'student_groups', 'participants'] },
        { schema: 'analytics', tables: ['session_metrics', 'group_metrics', 'student_metrics'] },
        { schema: 'compliance', tables: ['audit_log', 'parental_consents', 'coppa_compliance'] },
        { schema: 'ai_insights', tables: ['analysis_results', 'intervention_suggestions'] },
        { schema: 'operational', tables: ['system_events', 'api_metrics'] }
      ];
      
      for (const { schema, tables } of keyTables) {
        logger.debug(`\n   ${schema} schema:`);
        for (const table of tables) {
          try {
            await databricksService.query(`SELECT 1 FROM classwaves.${schema}.${table} LIMIT 1`);
            logger.debug(`     - ${table}: ✅`);
          } catch (error) {
            logger.debug(`     - ${table}: ❌`);
          }
        }
      }
      
      // Check demo data
      logger.debug('\n🧪 Checking demo data:');
      try {
        const demoSchool = await databricksService.queryOne(
          'SELECT * FROM classwaves.users.schools WHERE domain = ?',
          ['demo.classwaves.com']
        );
        if (demoSchool) {
          logger.debug('   ✅ Demo school created');
        }
        
        const demoTeacher = await databricksService.queryOne(
          'SELECT * FROM classwaves.users.teachers WHERE email = ?',
          ['teacher@demo.classwaves.com']
        );
        if (demoTeacher) {
          logger.debug('   ✅ Demo teacher created');
        }
      } catch (error) {
        logger.debug('   ❌ Could not verify demo data');
      }
      
    } catch (error: any) {
      logger.debug('❌ Could not verify structure:', error.message);
    }
    
    logger.debug('\n✨ Catalog structure creation completed!');
    
  } catch (error) {
    logger.error('\n❌ Fatal error:', error);
    throw error;
  } finally {
    await databricksService.disconnect();
    logger.debug('\n👋 Disconnected from Databricks');
  }
}

if (require.main === module) {
  createCatalogStructure().catch(console.error);
}

export { createCatalogStructure };
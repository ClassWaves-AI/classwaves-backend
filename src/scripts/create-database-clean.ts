import { databricksService } from '../services/databricks.service';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

async function createDatabaseClean() {
  logger.debug('🚀 Starting clean ClassWaves database creation...\n');
  
  try {
    await databricksService.connect();
    logger.debug('✅ Connected to Databricks\n');
    
    // Step 1: Create catalog if not exists
    logger.debug('📚 Step 1: Creating catalog...');
    try {
      await databricksService.query('CREATE CATALOG IF NOT EXISTS classwaves');
      logger.debug('✅ Catalog created or already exists');
    } catch (error: any) {
      logger.debug('❌ Error creating catalog:', error.message);
      throw error;
    }
    
    // Step 2: Use catalog
    logger.debug('\n📚 Step 2: Using catalog...');
    await databricksService.query('USE CATALOG classwaves');
    logger.debug('✅ Using catalog classwaves');
    
    // Step 3: Create schema
    logger.debug('\n📁 Step 3: Creating schema...');
    try {
      await databricksService.query('CREATE SCHEMA IF NOT EXISTS main');
      logger.debug('✅ Schema created or already exists');
    } catch (error: any) {
      logger.debug('❌ Error creating schema:', error.message);
      throw error;
    }
    
    // Step 4: Use schema
    logger.debug('\n📁 Step 4: Using schema...');
    await databricksService.query('USE SCHEMA main');
    logger.debug('✅ Using schema main');
    
    // Verify context
    const currentCatalog = await databricksService.query('SELECT current_catalog()');
    const currentSchema = await databricksService.query('SELECT current_schema()');
    logger.debug(`\n📍 Current context:`);
    logger.debug(`   - Catalog: ${currentCatalog[0]['current_catalog()']}`);
    logger.debug(`   - Schema: ${currentSchema[0]['current_schema()']}`);
    
    // Step 5: Create tables one by one
    logger.debug('\n📋 Step 5: Creating tables...\n');
    
    const tables = [
      {
        name: 'schools',
        sql: `CREATE TABLE IF NOT EXISTS schools (
          id STRING NOT NULL,
          name STRING NOT NULL,
          domain STRING NOT NULL,
          google_workspace_id STRING,
          admin_email STRING NOT NULL,
          subscription_tier STRING NOT NULL,
          subscription_status STRING NOT NULL,
          max_teachers INT NOT NULL,
          current_teachers INT NOT NULL,
          stripe_customer_id STRING,
          subscription_start_date TIMESTAMP,
          subscription_end_date TIMESTAMP,
          trial_ends_at TIMESTAMP,
          ferpa_agreement BOOLEAN NOT NULL,
          coppa_compliant BOOLEAN NOT NULL,
          data_retention_days INT NOT NULL,
          created_at TIMESTAMP NOT NULL,
          updated_at TIMESTAMP NOT NULL,
          PRIMARY KEY (id)
        ) USING DELTA`
      },
      {
        name: 'teachers',
        sql: `CREATE TABLE IF NOT EXISTS teachers (
          id STRING NOT NULL,
          google_id STRING NOT NULL,
          email STRING NOT NULL,
          name STRING NOT NULL,
          picture STRING,
          school_id STRING NOT NULL,
          role STRING NOT NULL,
          status STRING NOT NULL,
          access_level STRING NOT NULL,
          max_concurrent_sessions INT NOT NULL,
          current_sessions INT NOT NULL,
          grade STRING,
          subject STRING,
          timezone STRING NOT NULL,
          features_enabled STRING,
          last_login TIMESTAMP,
          login_count INT NOT NULL,
          total_sessions_created INT NOT NULL,
          created_at TIMESTAMP NOT NULL,
          updated_at TIMESTAMP NOT NULL,
          PRIMARY KEY (id),
          FOREIGN KEY (school_id) REFERENCES schools(id)
        ) USING DELTA`
      },
      {
        name: 'sessions',
        sql: `CREATE TABLE IF NOT EXISTS sessions (
          id STRING NOT NULL,
          title STRING NOT NULL,
          description STRING,
          status STRING NOT NULL,
          scheduled_start TIMESTAMP,
          actual_start TIMESTAMP,
          actual_end TIMESTAMP,
          planned_duration_minutes INT NOT NULL,
          actual_duration_minutes INT,
          max_students INT NOT NULL,
          target_group_size INT NOT NULL,
          auto_group_enabled BOOLEAN NOT NULL,
          teacher_id STRING NOT NULL,
          school_id STRING NOT NULL,
          recording_enabled BOOLEAN NOT NULL,
          transcription_enabled BOOLEAN NOT NULL,
          ai_analysis_enabled BOOLEAN NOT NULL,
          ferpa_compliant BOOLEAN NOT NULL,
          coppa_compliant BOOLEAN NOT NULL,
          recording_consent_obtained BOOLEAN NOT NULL,
          data_retention_date TIMESTAMP,
          total_groups INT NOT NULL,
          total_students INT NOT NULL,
          participation_rate DECIMAL(5,2) NOT NULL,
          engagement_score DECIMAL(5,2) NOT NULL,
          created_at TIMESTAMP NOT NULL,
          updated_at TIMESTAMP NOT NULL,
          PRIMARY KEY (id),
          FOREIGN KEY (teacher_id) REFERENCES teachers(id),
          FOREIGN KEY (school_id) REFERENCES schools(id)
        ) USING DELTA`
      },
      {
        name: 'audit_log',
        sql: `CREATE TABLE IF NOT EXISTS audit_log (
          id STRING NOT NULL,
          actor_id STRING NOT NULL,
          actor_type STRING NOT NULL,
          event_type STRING NOT NULL,
          event_category STRING NOT NULL,
          event_timestamp TIMESTAMP NOT NULL,
          resource_type STRING NOT NULL,
          resource_id STRING,
          school_id STRING NOT NULL,
          session_id STRING,
          description STRING NOT NULL,
          ip_address STRING,
          user_agent STRING,
          compliance_basis STRING,
          data_accessed STRING,
          affected_student_ids STRING,
          created_at TIMESTAMP NOT NULL,
          PRIMARY KEY (id),
          FOREIGN KEY (school_id) REFERENCES schools(id)
        ) USING DELTA`
      }
    ];
    
    for (const table of tables) {
      process.stdout.write(`Creating table ${table.name}... `);
      try {
        await databricksService.query(table.sql);
        logger.debug('✅');
      } catch (error: any) {
        logger.debug('❌');
        logger.debug(`   Error: ${error.message}`);
      }
    }
    
    // Step 6: Enable column defaults
    logger.debug('\n🔧 Step 6: Enabling column defaults for tables...\n');
    const tablesToAlter = ['schools', 'teachers', 'sessions'];
    
    for (const tableName of tablesToAlter) {
      process.stdout.write(`Enabling column defaults for ${tableName}... `);
      try {
        await databricksService.query(
          `ALTER TABLE ${tableName} SET TBLPROPERTIES('delta.feature.allowColumnDefaults' = 'supported')`
        );
        logger.debug('✅');
      } catch (error: any) {
        logger.debug('❌');
        logger.debug(`   Error: ${error.message}`);
      }
    }
    
    // Step 7: Insert demo data
    logger.debug('\n📝 Step 7: Inserting demo data...\n');
    
    process.stdout.write('Inserting demo school... ');
    try {
      await databricksService.query(`
        INSERT INTO schools (
          id, name, domain, admin_email, subscription_tier, subscription_status,
          max_teachers, current_teachers, ferpa_agreement, coppa_compliant,
          data_retention_days, created_at, updated_at
        ) VALUES (
          'sch_demo_001', 'Demo Elementary School', 'demo.classwaves.com',
          'admin@demo.classwaves.com', 'premium', 'active', 50, 0, true, true,
          365, current_timestamp(), current_timestamp()
        )
      `);
      logger.debug('✅');
    } catch (error: any) {
      logger.debug('❌');
      logger.debug(`   Error: ${error.message}`);
    }
    
    process.stdout.write('Inserting demo teacher... ');
    try {
      await databricksService.query(`
        INSERT INTO teachers (
          id, google_id, email, name, school_id, role, status, access_level,
          max_concurrent_sessions, current_sessions, timezone, login_count,
          total_sessions_created, created_at, updated_at
        ) VALUES (
          'tch_demo_001', 'demo_google_id_12345', 'teacher@demo.classwaves.com',
          'Demo Teacher', 'sch_demo_001', 'teacher', 'active', 'full', 5, 0,
          'America/Los_Angeles', 0, 0, current_timestamp(), current_timestamp()
        )
      `);
      logger.debug('✅');
    } catch (error: any) {
      logger.debug('❌');
      logger.debug(`   Error: ${error.message}`);
    }
    
    // Step 8: Verify tables
    logger.debug('\n🔍 Step 8: Verifying tables...\n');
    const verifyTables = ['schools', 'teachers', 'sessions', 'audit_log'];
    
    for (const tableName of verifyTables) {
      process.stdout.write(`Checking ${tableName}... `);
      try {
        const result = await databricksService.query(`SELECT COUNT(*) as count FROM ${tableName}`);
        logger.debug(`✅ (${result[0].count} rows)`);
      } catch (error: any) {
        logger.debug('❌ Not found');
      }
    }
    
    logger.debug('\n✨ Database creation completed!');
    
  } catch (error) {
    logger.error('\n❌ Fatal error:', error);
    throw error;
  } finally {
    await databricksService.disconnect();
    logger.debug('\n👋 Disconnected from Databricks');
  }
}

if (require.main === module) {
  createDatabaseClean().catch(console.error);
}

export { createDatabaseClean };
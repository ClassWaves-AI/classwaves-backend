import axios from 'axios';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

class UnityCatalogCreator {
  private host: string;
  private token: string | undefined;
  private warehouseId: string;
  private catalog: string;
  private axiosConfig: any;

  constructor() {
    this.host = 'https://dbc-d5db37cb-5441.cloud.databricks.com';
    this.token = process.env.DATABRICKS_TOKEN;
    this.warehouseId = '077a4c2149eade40';
    this.catalog = 'classwaves';
    
    this.axiosConfig = {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      }
    };
  }

  async executeStatement(statement: string): Promise<{ success: boolean; result?: any; error?: string }> {
    logger.debug(`Executing: ${statement.substring(0, 100)}...`);
    
    try {
      const response = await axios.post(
        `${this.host}/api/2.0/sql/statements`,
        {
          warehouse_id: this.warehouseId,
          statement: statement,
          wait_timeout: '30s'
        },
        this.axiosConfig
      );

      // Check immediate status
      if (response.data.status?.state === 'SUCCEEDED') {
        logger.debug('✅ Success');
        return { success: true, result: response.data.result };
      } else if (response.data.status?.state === 'FAILED') {
        const error = response.data.status?.error?.message || 'Unknown error';
        logger.debug(`❌ Failed: ${error}`);
        return { success: false, error };
      }

      // Wait for completion if pending
      const statementId = response.data.statement_id;
      let attempts = 0;
      
      while (attempts < 15) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const statusResponse = await axios.get(
          `${this.host}/api/2.0/sql/statements/${statementId}`,
          this.axiosConfig
        );

        const state = statusResponse.data.status?.state;
        
        if (state === 'SUCCEEDED') {
          logger.debug('✅ Success');
          return { success: true, result: statusResponse.data.result };
        } else if (state === 'FAILED') {
          const error = statusResponse.data.status?.error?.message || 'Unknown error';
          logger.debug(`❌ Failed: ${error}`);
          return { success: false, error };
        }
        
        attempts++;
      }

      logger.debug('❌ Timeout');
      return { success: false, error: 'Timeout waiting for statement completion' };
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || error.message;
      logger.debug(`❌ Error: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  async createStructure() {
    logger.debug('🚀 Creating Unity Catalog Structure for ClassWaves\n');
    logger.debug(`📍 Catalog: ${this.catalog}`);
    logger.debug(`🏢 Host: ${this.host}`);
    logger.debug(`📦 Warehouse: ${this.warehouseId}\n`);

    // Step 1: Create schemas
    logger.debug('Step 1: Creating schemas in classwaves catalog\n');
    
    const schemas = [
      'users',
      'sessions',
      'analytics',
      'compliance',
      'ai_insights',
      'operational',
      'admin',
      'communication',
      'audio',
      'notifications'
    ];

    for (const schema of schemas) {
      await this.executeStatement(`CREATE SCHEMA IF NOT EXISTS ${this.catalog}.${schema}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Step 2: Create tables
    logger.debug('\nStep 2: Creating tables\n');

    const tables = [
      // Users schema
      {
        name: 'users.schools',
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.users.schools (
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
          updated_at TIMESTAMP NOT NULL
        ) USING DELTA`
      },
      {
        name: 'users.teachers',
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.users.teachers (
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
          updated_at TIMESTAMP NOT NULL
        ) USING DELTA`
      },
      // Sessions schema
      {
        name: 'sessions.classroom_sessions',
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.sessions.classroom_sessions (
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
          access_code STRING,
          recording_enabled BOOLEAN NOT NULL,
          transcription_enabled BOOLEAN NOT NULL,
          ai_analysis_enabled BOOLEAN NOT NULL,
          ferpa_compliant BOOLEAN NOT NULL,
          coppa_compliant BOOLEAN NOT NULL,
          recording_consent_obtained BOOLEAN NOT NULL,
          data_retention_date TIMESTAMP,
          total_groups INT NOT NULL,
          total_students INT NOT NULL,
          engagement_score DECIMAL(5,2) DEFAULT 0.0,
          created_at TIMESTAMP NOT NULL,
          updated_at TIMESTAMP NOT NULL
        ) USING DELTA`
      },
      {
        name: 'sessions.student_groups',
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.sessions.student_groups (
          id STRING NOT NULL,
          session_id STRING NOT NULL,
          name STRING NOT NULL,
          group_number INT NOT NULL,
          status STRING NOT NULL,
          max_size INT NOT NULL,
          current_size INT NOT NULL,
          auto_managed BOOLEAN NOT NULL,
          start_time TIMESTAMP,
          end_time TIMESTAMP,
          total_speaking_time_seconds INT,
          participation_balance DECIMAL(5,2),
          collaboration_score DECIMAL(5,2),
          topic_focus_score DECIMAL(5,2),
          created_at TIMESTAMP NOT NULL,
          updated_at TIMESTAMP NOT NULL
        ) USING DELTA`
      },
      {
        name: 'sessions.participants',
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.sessions.participants (
          id STRING NOT NULL,
          session_id STRING NOT NULL,
          group_id STRING,
          student_id STRING,
          anonymous_id STRING,
          display_name STRING NOT NULL,
          join_time TIMESTAMP NOT NULL,
          leave_time TIMESTAMP,
          is_active BOOLEAN NOT NULL,
          device_type STRING,
          browser_info STRING,
          connection_quality STRING,
          can_speak BOOLEAN NOT NULL,
          can_hear BOOLEAN NOT NULL,
          is_muted BOOLEAN NOT NULL,
          total_speaking_time_seconds INT,
          message_count INT,
          interaction_count INT,
          created_at TIMESTAMP NOT NULL,
          updated_at TIMESTAMP NOT NULL
        ) USING DELTA`
      },
      // Compliance schema
      {
        name: 'compliance.audit_log',
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.compliance.audit_log (
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
          created_at TIMESTAMP NOT NULL
        ) USING DELTA`
      },
      // Admin schema
      {
        name: 'admin.school_settings',
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.admin.school_settings (
          id STRING NOT NULL,
          school_id STRING NOT NULL,
          setting_key STRING NOT NULL,
          setting_value STRING NOT NULL,
          setting_type STRING NOT NULL,
          description STRING,
          is_editable BOOLEAN NOT NULL,
          created_at TIMESTAMP NOT NULL,
          updated_at TIMESTAMP NOT NULL
        ) USING DELTA`
      }
    ];

    for (const table of tables) {
      await this.executeStatement(table.ddl);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Step 3: Insert demo data
    logger.debug('\nStep 3: Inserting demo data\n');

    const demoData = [
      `INSERT INTO ${this.catalog}.users.schools (
        id, name, domain, admin_email, subscription_tier, subscription_status,
        max_teachers, current_teachers, ferpa_agreement, coppa_compliant,
        data_retention_days, created_at, updated_at
      ) VALUES (
        'sch_demo_001', 'Demo Elementary School', 'demo.classwaves.com',
        'admin@demo.classwaves.com', 'premium', 'active', 50, 0, true, true,
        365, current_timestamp(), current_timestamp()
      )`,
      
      `INSERT INTO ${this.catalog}.users.teachers (
        id, google_id, email, name, school_id, role, status, access_level,
        max_concurrent_sessions, current_sessions, timezone, login_count,
        total_sessions_created, created_at, updated_at
      ) VALUES (
        'tch_demo_001', 'demo_google_id_12345', 'teacher@demo.classwaves.com',
        'Demo Teacher', 'sch_demo_001', 'teacher', 'active', 'full', 5, 0,
        'America/Los_Angeles', 0, 0, current_timestamp(), current_timestamp()
      )`
    ];

    for (const stmt of demoData) {
      await this.executeStatement(stmt);
    }

    // Step 4: Verify
    logger.debug('\nStep 4: Verifying structure\n');

    const verifyResult = await this.executeStatement(
      `SELECT COUNT(*) FROM ${this.catalog}.users.schools`
    );
    
    if (verifyResult.success && verifyResult.result) {
      const count = verifyResult.result.data_array[0][0];
      logger.debug(`\nDemo data verified: ${count} schools in database`);
    }

    logger.debug('\n✨ Unity Catalog structure created successfully!');
  }
}

async function main() {
  const creator = new UnityCatalogCreator();
  
  try {
    await creator.createStructure();
    process.exit(0);
  } catch (error) {
    logger.error('❌ Failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export default UnityCatalogCreator;
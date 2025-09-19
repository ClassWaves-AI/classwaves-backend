import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

/**
 * Creates Databricks Unity Catalog structure for ClassWaves
 * Hierarchy: Catalog → Schema → Tables
 */
class ClassWavesCatalogCreator {
  private host: string;
  private token: string | undefined;
  private warehouseId: string;
  private catalog: string;
  private axiosConfig: any;
  private schemas: string[];
  private tables: any[];

  constructor() {
    this.host = 'https://dbc-d5db37cb-5441.cloud.databricks.com';
    this.token = process.env.DATABRICKS_TOKEN;
    this.warehouseId = '077a4c2149eade40';
    this.catalog = 'classwaves'; // Using the existing classwaves catalog
    
    this.axiosConfig = {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      }
    };

    // Define schemas
    this.schemas = [
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
    
    // Define tables organized by schema
    this.tables = [
      // USERS SCHEMA - Authentication and user management
      {
        schema: 'users',
        name: 'schools',
        sql: `CREATE TABLE IF NOT EXISTS users.schools (
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
        schema: 'users',
        name: 'teachers',
        sql: `CREATE TABLE IF NOT EXISTS users.teachers (
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
      {
        schema: 'users',
        name: 'students',
        sql: `CREATE TABLE IF NOT EXISTS users.students (
          id STRING NOT NULL,
          display_name STRING NOT NULL,
          school_id STRING NOT NULL,
          email STRING,
          google_id STRING,
          status STRING NOT NULL,
          grade_level STRING,
          has_parental_consent BOOLEAN NOT NULL,
          consent_date TIMESTAMP,
          parent_email STRING,
          data_sharing_consent BOOLEAN NOT NULL,
          audio_recording_consent BOOLEAN NOT NULL,
          created_at TIMESTAMP NOT NULL,
          updated_at TIMESTAMP NOT NULL
        ) USING DELTA`
      },

      // SESSIONS SCHEMA - Real-time session management
      {
        schema: 'sessions',
        name: 'classroom_sessions',
        sql: `CREATE TABLE IF NOT EXISTS sessions.classroom_sessions (
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
          updated_at TIMESTAMP NOT NULL
        ) USING DELTA
        PARTITIONED BY (school_id)`
      },
      {
        schema: 'sessions',
        name: 'student_groups',
        sql: `CREATE TABLE IF NOT EXISTS sessions.student_groups (
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
        ) USING DELTA
        PARTITIONED BY (session_id)`
      },
      {
        schema: 'sessions',
        name: 'participants',
        sql: `CREATE TABLE IF NOT EXISTS sessions.participants (
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
        ) USING DELTA
        PARTITIONED BY (session_id)`
      },
      {
        schema: 'sessions',
        name: 'transcriptions',
        sql: `CREATE TABLE IF NOT EXISTS sessions.transcriptions (
          id STRING NOT NULL,
          session_id STRING NOT NULL,
          group_id STRING,
          speaker_id STRING NOT NULL,
          speaker_type STRING NOT NULL,
          speaker_name STRING NOT NULL,
          content STRING NOT NULL,
          language_code STRING NOT NULL,
          start_time TIMESTAMP NOT NULL,
          end_time TIMESTAMP NOT NULL,
          duration_seconds DECIMAL(10,3) NOT NULL,
          confidence_score DECIMAL(5,4) NOT NULL,
          is_final BOOLEAN NOT NULL,
          sentiment STRING,
          key_phrases STRING,
          academic_vocabulary_detected BOOLEAN,
          created_at TIMESTAMP NOT NULL
        ) USING DELTA
        PARTITIONED BY (session_id)`
      },

      // ANALYTICS SCHEMA - Educational metrics and insights
      {
        schema: 'analytics',
        name: 'session_metrics',
        sql: `CREATE TABLE IF NOT EXISTS analytics.session_metrics (
          id STRING NOT NULL,
          session_id STRING NOT NULL,
          calculation_timestamp TIMESTAMP NOT NULL,
          total_students INT NOT NULL,
          active_students INT NOT NULL,
          participation_rate DECIMAL(5,2) NOT NULL,
          average_speaking_time_seconds DECIMAL(10,2),
          speaking_time_std_dev DECIMAL(10,2),
          overall_engagement_score DECIMAL(5,2) NOT NULL,
          attention_score DECIMAL(5,2),
          interaction_score DECIMAL(5,2),
          collaboration_score DECIMAL(5,2),
          on_topic_percentage DECIMAL(5,2),
          academic_vocabulary_usage DECIMAL(5,2),
          question_asking_rate DECIMAL(5,2),
          group_formation_time_seconds INT,
          average_group_size DECIMAL(5,2),
          group_stability_score DECIMAL(5,2),
          average_connection_quality DECIMAL(5,2),
          technical_issues_count INT,
          created_at TIMESTAMP NOT NULL
        ) USING DELTA`
      },
      {
        schema: 'analytics',
        name: 'group_metrics',
        sql: `CREATE TABLE IF NOT EXISTS analytics.group_metrics (
          id STRING NOT NULL,
          group_id STRING NOT NULL,
          session_id STRING NOT NULL,
          calculation_timestamp TIMESTAMP NOT NULL,
          participation_equality_index DECIMAL(5,4),
          dominant_speaker_percentage DECIMAL(5,2),
          silent_members_count INT,
          turn_taking_score DECIMAL(5,2),
          interruption_rate DECIMAL(5,2),
          supportive_interactions_count INT,
          topic_coherence_score DECIMAL(5,2),
          vocabulary_diversity_score DECIMAL(5,2),
          academic_discourse_score DECIMAL(5,2),
          average_sentiment_score DECIMAL(5,2),
          emotional_support_instances INT,
          conflict_instances INT,
          created_at TIMESTAMP NOT NULL
        ) USING DELTA
        PARTITIONED BY (session_id)`
      },
      {
        schema: 'analytics',
        name: 'student_metrics',
        sql: `CREATE TABLE IF NOT EXISTS analytics.student_metrics (
          id STRING NOT NULL,
          participant_id STRING NOT NULL,
          session_id STRING NOT NULL,
          calculation_timestamp TIMESTAMP NOT NULL,
          total_speaking_time_seconds INT NOT NULL,
          speaking_turns_count INT,
          average_turn_duration_seconds DECIMAL(10,2),
          participation_score DECIMAL(5,2),
          initiative_score DECIMAL(5,2),
          responsiveness_score DECIMAL(5,2),
          vocabulary_complexity_score DECIMAL(5,2),
          grammar_accuracy_score DECIMAL(5,2),
          fluency_score DECIMAL(5,2),
          peer_interaction_count INT,
          supportive_comments_count INT,
          questions_asked_count INT,
          average_sentiment DECIMAL(5,2),
          confidence_level DECIMAL(5,2),
          stress_indicators_count INT,
          created_at TIMESTAMP NOT NULL
        ) USING DELTA
        PARTITIONED BY (session_id)`
      },
      {
        schema: 'analytics',
        name: 'educational_metrics',
        sql: `CREATE TABLE IF NOT EXISTS analytics.educational_metrics (
          id STRING NOT NULL,
          session_id STRING NOT NULL,
          metric_type STRING NOT NULL,
          metric_name STRING NOT NULL,
          metric_value DECIMAL(10,4),
          metric_metadata MAP<STRING, STRING>,
          aggregation_level STRING,
          calculation_timestamp TIMESTAMP NOT NULL,
          created_at TIMESTAMP NOT NULL
        ) USING DELTA
        PARTITIONED BY (session_id)`
      },

      // COMPLIANCE SCHEMA - FERPA/COPPA compliance and audit
      {
        schema: 'compliance',
        name: 'audit_log',
        sql: `CREATE TABLE IF NOT EXISTS compliance.audit_log (
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
        ) USING DELTA
        PARTITIONED BY (school_id)`
      },
      {
        schema: 'compliance',
        name: 'parental_consents',
        sql: `CREATE TABLE IF NOT EXISTS compliance.parental_consents (
          id STRING NOT NULL,
          student_id STRING NOT NULL,
          school_id STRING NOT NULL,
          consent_type STRING NOT NULL,
          consent_given BOOLEAN NOT NULL,
          consent_date TIMESTAMP NOT NULL,
          parent_name STRING NOT NULL,
          parent_email STRING NOT NULL,
          relationship STRING NOT NULL,
          verification_method STRING NOT NULL,
          verification_token STRING,
          verified_at TIMESTAMP,
          ip_address STRING,
          user_agent STRING,
          consent_text_version STRING NOT NULL,
          expires_at TIMESTAMP,
          revoked_at TIMESTAMP,
          created_at TIMESTAMP NOT NULL,
          updated_at TIMESTAMP NOT NULL
        ) USING DELTA
        PARTITIONED BY (school_id)`
      },
      {
        schema: 'compliance',
        name: 'retention_policies',
        sql: `CREATE TABLE IF NOT EXISTS compliance.retention_policies (
          id STRING NOT NULL,
          school_id STRING NOT NULL,
          policy_type STRING NOT NULL,
          retention_days INT NOT NULL,
          delete_after_days INT,
          archive_after_days INT,
          legal_basis STRING NOT NULL,
          auto_delete_enabled BOOLEAN NOT NULL,
          created_at TIMESTAMP NOT NULL,
          updated_at TIMESTAMP NOT NULL
        ) USING DELTA`
      },
      {
        schema: 'compliance',
        name: 'coppa_compliance',
        sql: `CREATE TABLE IF NOT EXISTS compliance.coppa_compliance (
          id STRING NOT NULL,
          student_id STRING NOT NULL,
          school_id STRING NOT NULL,
          birth_year INT,
          is_under_13 BOOLEAN NOT NULL,
          age_verification_method STRING,
          age_verified_at TIMESTAMP,
          data_collection_limited BOOLEAN NOT NULL,
          no_behavioral_targeting BOOLEAN NOT NULL,
          no_third_party_sharing BOOLEAN NOT NULL,
          auto_delete_enabled BOOLEAN NOT NULL,
          delete_after_days INT,
          deletion_requested_at TIMESTAMP,
          deletion_completed_at TIMESTAMP,
          parent_access_enabled BOOLEAN NOT NULL,
          parent_last_reviewed TIMESTAMP,
          created_at TIMESTAMP NOT NULL,
          updated_at TIMESTAMP NOT NULL
        ) USING DELTA`
      },

      // AI_INSIGHTS SCHEMA - AI analysis and insights
      {
        schema: 'ai_insights',
        name: 'analysis_results',
        sql: `CREATE TABLE IF NOT EXISTS ai_insights.analysis_results (
          id STRING NOT NULL,
          session_id STRING NOT NULL,
          analysis_type STRING NOT NULL,
          analysis_timestamp TIMESTAMP NOT NULL,
          processing_time_ms INT NOT NULL,
          result_data STRING NOT NULL,
          confidence_score DECIMAL(5,4),
          model_version STRING NOT NULL,
          created_at TIMESTAMP NOT NULL
        ) USING DELTA
        PARTITIONED BY (session_id)`
      },
      {
        schema: 'ai_insights',
        name: 'intervention_suggestions',
        sql: `CREATE TABLE IF NOT EXISTS ai_insights.intervention_suggestions (
          id STRING NOT NULL,
          session_id STRING NOT NULL,
          group_id STRING,
          teacher_id STRING NOT NULL,
          intervention_type STRING NOT NULL,
          urgency STRING NOT NULL,
          reason STRING NOT NULL,
          suggested_action STRING NOT NULL,
          target_type STRING NOT NULL,
          target_student_id STRING,
          status STRING NOT NULL,
          acted_upon BOOLEAN,
          acted_at TIMESTAMP,
          was_effective BOOLEAN,
          created_at TIMESTAMP NOT NULL
        ) USING DELTA
        PARTITIONED BY (session_id)`
      },
      {
        schema: 'ai_insights',
        name: 'educational_insights',
        sql: `CREATE TABLE IF NOT EXISTS ai_insights.educational_insights (
          id STRING NOT NULL,
          session_id STRING NOT NULL,
          insight_type STRING NOT NULL,
          title STRING NOT NULL,
          description STRING NOT NULL,
          recommendations STRING,
          impact_score DECIMAL(5,2),
          confidence_level DECIMAL(5,2),
          applies_to_type STRING NOT NULL,
          applies_to_id STRING,
          created_at TIMESTAMP NOT NULL
        ) USING DELTA`
      },

      // OPERATIONAL SCHEMA - System operations and monitoring
      {
        schema: 'operational',
        name: 'system_events',
        sql: `CREATE TABLE IF NOT EXISTS operational.system_events (
          id STRING NOT NULL,
          event_type STRING NOT NULL,
          severity STRING NOT NULL,
          component STRING NOT NULL,
          message STRING NOT NULL,
          error_details STRING,
          school_id STRING,
          session_id STRING,
          user_id STRING,
          created_at TIMESTAMP NOT NULL
        ) USING DELTA`
      },
      {
        schema: 'operational',
        name: 'api_metrics',
        sql: `CREATE TABLE IF NOT EXISTS operational.api_metrics (
          id STRING NOT NULL,
          endpoint STRING NOT NULL,
          method STRING NOT NULL,
          response_time_ms INT NOT NULL,
          status_code INT NOT NULL,
          user_id STRING,
          school_id STRING,
          ip_address STRING,
          user_agent STRING,
          timestamp TIMESTAMP NOT NULL
        ) USING DELTA`
      },
      {
        schema: 'operational',
        name: 'background_jobs',
        sql: `CREATE TABLE IF NOT EXISTS operational.background_jobs (
          id STRING NOT NULL,
          job_type STRING NOT NULL,
          status STRING NOT NULL,
          scheduled_at TIMESTAMP NOT NULL,
          started_at TIMESTAMP,
          completed_at TIMESTAMP,
          parameters STRING,
          result STRING,
          error_message STRING,
          retry_count INT NOT NULL,
          created_at TIMESTAMP NOT NULL,
          updated_at TIMESTAMP NOT NULL
        ) USING DELTA`
      },

      // ADMIN SCHEMA - School and district management
      {
        schema: 'admin',
        name: 'districts',
        sql: `CREATE TABLE IF NOT EXISTS admin.districts (
          id STRING NOT NULL,
          name STRING NOT NULL,
          state STRING NOT NULL,
          region STRING,
          superintendent_name STRING,
          contact_email STRING,
          contact_phone STRING,
          website STRING,
          student_count INT,
          school_count INT,
          teacher_count INT,
          subscription_tier STRING NOT NULL,
          contract_details MAP<STRING, STRING>,
          is_active BOOLEAN NOT NULL,
          created_at TIMESTAMP NOT NULL,
          updated_at TIMESTAMP NOT NULL
        ) USING DELTA`
      },
      {
        schema: 'admin',
        name: 'school_settings',
        sql: `CREATE TABLE IF NOT EXISTS admin.school_settings (
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
      },

      // COMMUNICATION SCHEMA - Messaging and notifications
      {
        schema: 'communication',
        name: 'messages',
        sql: `CREATE TABLE IF NOT EXISTS communication.messages (
          id STRING NOT NULL,
          session_id STRING,
          sender_id STRING NOT NULL,
          sender_type STRING NOT NULL,
          recipient_id STRING,
          recipient_type STRING,
          message_type STRING NOT NULL,
          subject STRING,
          content STRING NOT NULL,
          metadata MAP<STRING, STRING>,
          is_read BOOLEAN NOT NULL,
          is_archived BOOLEAN NOT NULL,
          is_deleted BOOLEAN NOT NULL,
          created_at TIMESTAMP NOT NULL,
          read_at TIMESTAMP,
          deleted_at TIMESTAMP
        ) USING DELTA
        PARTITIONED BY (session_id)`
      },

      // AUDIO SCHEMA - Audio recordings and processing
      {
        schema: 'audio',
        name: 'recordings',
        sql: `CREATE TABLE IF NOT EXISTS audio.recordings (
          id STRING NOT NULL,
          session_id STRING NOT NULL,
          group_id STRING,
          participant_id STRING,
          file_path STRING NOT NULL,
          file_size_bytes BIGINT,
          duration_seconds INT,
          format STRING NOT NULL,
          sample_rate INT NOT NULL,
          channels INT NOT NULL,
          codec STRING,
          is_processed BOOLEAN NOT NULL,
          transcription_status STRING NOT NULL,
          processing_attempts INT NOT NULL,
          last_error STRING,
          created_at TIMESTAMP NOT NULL,
          processed_at TIMESTAMP
        ) USING DELTA
        PARTITIONED BY (session_id)`
      },

      // NOTIFICATIONS SCHEMA - Notification management
      {
        schema: 'notifications',
        name: 'templates',
        sql: `CREATE TABLE IF NOT EXISTS notifications.templates (
          id STRING NOT NULL,
          name STRING NOT NULL,
          description STRING,
          channel STRING NOT NULL,
          category STRING NOT NULL,
          subject_template STRING,
          body_template STRING NOT NULL,
          variables ARRAY<STRING>,
          is_active BOOLEAN NOT NULL,
          version INT NOT NULL,
          created_by STRING,
          created_at TIMESTAMP NOT NULL,
          updated_at TIMESTAMP NOT NULL
        ) USING DELTA`
      },
      {
        schema: 'notifications',
        name: 'notification_queue',
        sql: `CREATE TABLE IF NOT EXISTS notifications.notification_queue (
          id STRING NOT NULL,
          user_id STRING NOT NULL,
          notification_type STRING NOT NULL,
          priority STRING NOT NULL,
          channel STRING NOT NULL,
          recipient_address STRING NOT NULL,
          subject STRING,
          content STRING NOT NULL,
          template_id STRING,
          template_data MAP<STRING, STRING>,
          scheduled_for TIMESTAMP,
          expires_at TIMESTAMP,
          retry_count INT NOT NULL,
          max_retries INT NOT NULL,
          status STRING NOT NULL,
          sent_at TIMESTAMP,
          failed_at TIMESTAMP,
          failure_reason STRING,
          created_at TIMESTAMP NOT NULL
        ) USING DELTA`
      }
    ];
  }

  async executeStatement(statement: string): Promise<{ success: boolean; error?: string }> {
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
        return { success: true };
      } else if (response.data.status?.state === 'FAILED') {
        return { 
          success: false, 
          error: response.data.status?.error?.message || 'Unknown error' 
        };
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
          return { success: true };
        } else if (state === 'FAILED') {
          return { 
            success: false, 
            error: statusResponse.data.status?.error?.message || 'Unknown error' 
          };
        }
        
        attempts++;
      }

      return { success: false, error: 'Timeout waiting for statement completion' };
    } catch (error: any) {
      return { 
        success: false, 
        error: error.response?.data?.message || error.message 
      };
    }
  }

  async createCatalogStructure() {
    logger.debug('🚀 Starting ClassWaves Unity Catalog structure creation...\n');
    logger.debug(`📍 Target: ${this.catalog} catalog`);
    logger.debug(`🏢 Host: ${this.host}`);
    logger.debug(`📦 Warehouse: ${this.warehouseId}\n`);

    const results: {
      successful: string[];
      failed: { item: string; error: any }[];
    } = {
      successful: [],
      failed: []
    };

    // Step 1: Use the catalog
    logger.debug(`\n${'='.repeat(50)}`);
    logger.debug(`Step 1: Setting catalog to: ${this.catalog}`);
    logger.debug(`${'='.repeat(50)}\n`);
    
    const catalogResult = await this.executeStatement(`USE CATALOG ${this.catalog}`);
    
    if (!catalogResult.success) {
      logger.error(`❌ Failed to switch to catalog ${this.catalog}: ${catalogResult.error}`);
      return results;
    }
    logger.debug(`✅ Using catalog: ${this.catalog}`);

    // Step 2: Create schemas
    logger.debug(`\n${'='.repeat(50)}`);
    logger.debug(`Step 2: Creating schemas`);
    logger.debug(`${'='.repeat(50)}\n`);

    for (const schema of this.schemas) {
      logger.debug(`Creating schema: ${schema}`);
      const schemaResult = await this.executeStatement(
        `CREATE SCHEMA IF NOT EXISTS ${schema}`
      );
      
      if (schemaResult.success) {
        logger.debug(`✅ Schema created: ${schema}`);
        results.successful.push(`schema:${schema}`);
      } else {
        logger.error(`❌ Failed to create schema ${schema}: ${schemaResult.error}`);
        results.failed.push({ item: `schema:${schema}`, error: schemaResult.error });
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Step 3: Create tables
    logger.debug(`\n${'='.repeat(50)}`);
    logger.debug(`Step 3: Creating tables`);
    logger.debug(`${'='.repeat(50)}\n`);

    for (const table of this.tables) {
      const tableName = `${this.catalog}.${table.schema}.${table.name}`;
      logger.debug(`Creating table: ${tableName}`);
      
      const result = await this.executeStatement(table.sql);
      
      if (result.success) {
        logger.debug(`✅ Successfully created ${tableName}`);
        results.successful.push(tableName);
      } else {
        logger.error(`❌ Failed to create ${tableName}: ${result.error}`);
        results.failed.push({ item: tableName, error: result.error });
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Step 4: Insert demo data
    logger.debug(`\n${'='.repeat(50)}`);
    logger.debug(`Step 4: Inserting demo data`);
    logger.debug(`${'='.repeat(50)}\n`);

    const demoStatements = [
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

    for (const stmt of demoStatements) {
      const result = await this.executeStatement(stmt);
      if (result.success) {
        logger.debug(`✅ Demo data inserted`);
      } else {
        logger.error(`❌ Failed to insert demo data: ${result.error}`);
      }
    }

    // Summary
    logger.debug('\n' + '='.repeat(50));
    logger.debug('UNITY CATALOG CREATION SUMMARY');
    logger.debug('='.repeat(50));
    logger.debug(`✅ Successful: ${results.successful.length} items`);
    logger.debug(`❌ Failed: ${results.failed.length} items`);
    
    if (results.successful.length > 0) {
      logger.debug('\nSuccessfully created:');
      results.successful.forEach(item => logger.debug(`  ✅ ${item}`));
    }
    
    if (results.failed.length > 0) {
      logger.debug('\nFailed items:');
      results.failed.forEach(f => logger.error(`  ❌ ${f.item}: ${f.error}`));
    }

    // Save results
    const resultsPath = path.join(__dirname, '../../../logs');
    if (!fs.existsSync(resultsPath)) {
      fs.mkdirSync(resultsPath, { recursive: true });
    }
    
    const resultsFile = path.join(resultsPath, 'unity-catalog-results.json');
    fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
    logger.debug(`\nResults saved to: ${resultsFile}`);

    return results;
  }
}

// Main execution
async function main() {
  const creator = new ClassWavesCatalogCreator();
  
  try {
    const results = await creator.createCatalogStructure();
    
    if (results.successful.length > 0) {
      logger.debug('\n🎉 Unity Catalog structure created successfully!');
      
      if (results.failed.length === 0) {
        logger.debug('\n✅ ALL SCHEMAS AND TABLES CREATED SUCCESSFULLY!');
      }
    }
    
    process.exit(results.failed.length === 0 ? 0 : 1);
  } catch (error) {
    logger.error('\n❌ Catalog creation failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export default ClassWavesCatalogCreator;
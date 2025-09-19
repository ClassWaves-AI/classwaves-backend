import axios from 'axios';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

class RemainingTablesCreator {
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

  async executeStatement(statement: string): Promise<{ success: boolean; error?: string }> {
    logger.debug(`Executing: ${statement.substring(0, 80)}...`);
    
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

      if (response.data.status?.state === 'SUCCEEDED') {
        logger.debug('✅ Success');
        return { success: true };
      } else if (response.data.status?.state === 'FAILED') {
        const error = response.data.status?.error?.message || 'Unknown error';
        logger.debug(`❌ Failed: ${error}`);
        return { success: false, error };
      }

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
          return { success: true };
        } else if (state === 'FAILED') {
          const error = statusResponse.data.status?.error?.message || 'Unknown error';
          logger.debug(`❌ Failed: ${error}`);
          return { success: false, error };
        }
        
        attempts++;
      }

      logger.debug('❌ Timeout');
      return { success: false, error: 'Timeout' };
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || error.message;
      logger.debug(`❌ Error: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  async createRemainingTables() {
    logger.debug('🚀 Creating remaining tables in ClassWaves Unity Catalog\n');

    const tables = [
      // ANALYTICS SCHEMA - Educational metrics and insights
      {
        schema: 'analytics',
        name: 'session_metrics',
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.analytics.session_metrics (
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
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.analytics.group_metrics (
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
        ) USING DELTA`
      },
      {
        schema: 'analytics',
        name: 'student_metrics',
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.analytics.student_metrics (
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
        ) USING DELTA`
      },
      {
        schema: 'analytics',
        name: 'educational_metrics',
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.analytics.educational_metrics (
          id STRING NOT NULL,
          session_id STRING NOT NULL,
          metric_type STRING NOT NULL,
          metric_name STRING NOT NULL,
          metric_value DECIMAL(10,4),
          metric_metadata MAP<STRING, STRING>,
          aggregation_level STRING,
          calculation_timestamp TIMESTAMP NOT NULL,
          created_at TIMESTAMP NOT NULL
        ) USING DELTA`
      },

      // AI_INSIGHTS SCHEMA - AI analysis and insights
      {
        schema: 'ai_insights',
        name: 'analysis_results',
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.ai_insights.analysis_results (
          id STRING NOT NULL,
          session_id STRING NOT NULL,
          analysis_type STRING NOT NULL,
          analysis_timestamp TIMESTAMP NOT NULL,
          processing_time_ms INT NOT NULL,
          result_data STRING NOT NULL,
          confidence_score DECIMAL(5,4),
          model_version STRING NOT NULL,
          created_at TIMESTAMP NOT NULL
        ) USING DELTA`
      },
      {
        schema: 'ai_insights',
        name: 'intervention_suggestions',
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.ai_insights.intervention_suggestions (
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
        ) USING DELTA`
      },
      {
        schema: 'ai_insights',
        name: 'educational_insights',
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.ai_insights.educational_insights (
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
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.operational.system_events (
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
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.operational.api_metrics (
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
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.operational.background_jobs (
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

      // COMMUNICATION SCHEMA - Messaging and notifications  
      {
        schema: 'communication',
        name: 'messages',
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.communication.messages (
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
        ) USING DELTA`
      },

      // AUDIO SCHEMA - Audio recordings and processing
      {
        schema: 'audio',
        name: 'recordings',
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.audio.recordings (
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
        ) USING DELTA`
      },

      // NOTIFICATIONS SCHEMA - Notification management
      {
        schema: 'notifications',
        name: 'templates',
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.notifications.templates (
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
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.notifications.notification_queue (
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
      },

      // Additional missing tables
      {
        schema: 'users',
        name: 'students',
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.users.students (
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
      {
        schema: 'sessions',
        name: 'transcriptions',
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.sessions.transcriptions (
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
        ) USING DELTA`
      },
      {
        schema: 'compliance',
        name: 'parental_consents',
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.compliance.parental_consents (
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
        ) USING DELTA`
      },
      {
        schema: 'compliance',
        name: 'retention_policies',
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.compliance.retention_policies (
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
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.compliance.coppa_compliance (
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
      {
        schema: 'admin',
        name: 'districts',
        ddl: `CREATE TABLE IF NOT EXISTS ${this.catalog}.admin.districts (
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
      }
    ];

    logger.debug(`Creating ${tables.length} tables across schemas...\n`);

    const results = {
      successful: 0,
      failed: 0,
      errors: [] as string[]
    };

    for (const table of tables) {
      logger.debug(`\n📋 Creating ${table.schema}.${table.name}`);
      const result = await this.executeStatement(table.ddl);
      
      if (result.success) {
        results.successful++;
      } else {
        results.failed++;
        results.errors.push(`${table.schema}.${table.name}: ${result.error}`);
      }
      
      // Small delay between operations
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Summary
    logger.debug('\n' + '='.repeat(50));
    logger.debug('SUMMARY');
    logger.debug('='.repeat(50));
    logger.debug(`✅ Successful: ${results.successful} tables`);
    logger.debug(`❌ Failed: ${results.failed} tables`);
    
    if (results.errors.length > 0) {
      logger.debug('\nErrors:');
      results.errors.forEach(err => logger.debug(`  - ${err}`));
    }

    // Insert demo district data
    if (results.successful > 0) {
      logger.debug('\n📊 Inserting demo district data...');
      await this.executeStatement(`
        INSERT INTO ${this.catalog}.admin.districts (
          id, name, state, region, subscription_tier, is_active,
          created_at, updated_at
        ) VALUES (
          'dst_demo_001', 'Demo School District', 'California', 'West Coast',
          'premium', true, current_timestamp(), current_timestamp()
        )
      `);
    }

    logger.debug('\n✨ Table creation completed!');
  }
}

async function main() {
  const creator = new RemainingTablesCreator();
  
  try {
    await creator.createRemainingTables();
    process.exit(0);
  } catch (error) {
    logger.error('❌ Failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export default RemainingTablesCreator;
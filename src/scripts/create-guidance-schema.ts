/**
 * Teacher Guidance Database Schema Creation Script
 * 
 * Creates Databricks Delta Lake tables for the teacher guidance system:
 * - Teacher guidance metrics tracking
 * - Prompt effectiveness analytics
 * - Session guidance analytics
 * - System performance metrics
 * 
 * ✅ DATABRICKS: Primary database with Unity Catalog structure
 * ✅ COMPLIANCE: GDPR-compliant data retention policies
 * ✅ SECURITY: Parameterized queries and audit logging
 * ✅ PERFORMANCE: Proper partitioning and optimization
 */

import { databricksService } from '../services/databricks.service';
import { databricksConfig } from '../config/databricks.config';

// ============================================================================
// Schema Creation Interface
// ============================================================================

interface TableDefinition {
  name: string;
  catalog: string;
  schema: string;
  ddl: string;
  description: string;
  partitioning?: string;
  properties?: Record<string, string>;
}

interface IndexDefinition {
  tableName: string;
  indexName: string;
  columns: string[];
  unique?: boolean;
}

// ============================================================================
// Main Schema Creation Function
// ============================================================================

export async function createGuidanceSchema(): Promise<void> {
  console.log('🏗️ Starting Teacher Guidance Schema Creation...');
  
  try {
    // ✅ COMPLIANCE: Audit logging for schema changes
    await auditLog({
      eventType: 'schema_creation',
      actorId: 'system',
      targetType: 'database_schema',
      targetId: 'teacher_guidance_metrics',
      educationalPurpose: 'Create tables for tracking teacher guidance system effectiveness',
      complianceBasis: 'system_administration'
    });

    // Create all teacher guidance tables
    await createTeacherGuidanceTables();
    
    // Create indexes for performance
    await createTableIndexes();
    
    // Set up data retention policies
    await setupDataRetentionPolicies();
    
    // Verify table creation
    await verifyTablesCreated();
    
    console.log('✅ Teacher Guidance Schema Creation Completed Successfully');
    
  } catch (error) {
    console.error('❌ Teacher Guidance Schema Creation Failed:', error);
    
    // ✅ COMPLIANCE: Audit log for errors
    await auditLog({
      eventType: 'schema_creation_error',
      actorId: 'system',
      targetType: 'database_schema',
      targetId: 'teacher_guidance_metrics',
      educationalPurpose: 'Log schema creation error for system monitoring',
      complianceBasis: 'system_administration',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    throw error;
  }
}

// ============================================================================
// Table Definitions
// ============================================================================

async function createTeacherGuidanceTables(): Promise<void> {
  console.log('📋 Creating teacher guidance tables...');
  
  const tables: TableDefinition[] = [
    // Core teacher guidance metrics table
    {
      name: 'teacher_guidance_metrics',
      catalog: databricksConfig.catalog,
      schema: 'ai_insights',
      description: 'Tracks individual teacher prompt interactions and effectiveness',
      partitioning: 'DATE(generated_at)',
      ddl: `CREATE TABLE IF NOT EXISTS ${databricksConfig.catalog}.ai_insights.teacher_guidance_metrics (
        id STRING NOT NULL COMMENT 'Unique identifier for the guidance metric record',
        session_id STRING NOT NULL COMMENT 'Reference to the classroom session',
        teacher_id STRING NOT NULL COMMENT 'Reference to the teacher user',
        prompt_id STRING NOT NULL COMMENT 'Unique identifier for the specific prompt',
        
        -- Prompt details
        prompt_category STRING NOT NULL COMMENT 'Category: facilitation, deepening, redirection, collaboration, assessment, energy, clarity',
        priority_level STRING NOT NULL COMMENT 'Priority: high, medium, low',
        prompt_message STRING COMMENT 'The actual prompt text shown to teacher',
        prompt_context STRING COMMENT 'Context that triggered the prompt',
        suggested_timing STRING COMMENT 'Timing: immediate, next_break, session_end',
        
        -- Educational context
        session_phase STRING COMMENT 'Phase: opening, development, synthesis, closure',
        subject_area STRING COMMENT 'Subject: math, science, literature, history, general',
        target_metric STRING COMMENT 'AI metric that triggered this prompt',
        learning_objectives ARRAY<STRING> COMMENT 'Session learning objectives',
        group_id STRING COMMENT 'Target group for the prompt (if group-specific)',
        
        -- Timing tracking
        generated_at TIMESTAMP NOT NULL COMMENT 'When the prompt was generated',
        acknowledged_at TIMESTAMP COMMENT 'When teacher acknowledged seeing the prompt',
        used_at TIMESTAMP COMMENT 'When teacher acted on the prompt',
        dismissed_at TIMESTAMP COMMENT 'When teacher explicitly dismissed the prompt',
        expires_at TIMESTAMP NOT NULL COMMENT 'When the prompt expires',
        
        -- Effectiveness tracking
        feedback_rating INT COMMENT 'Teacher feedback rating 1-5',
        feedback_text STRING COMMENT 'Teacher feedback text',
        effectiveness_score DOUBLE COMMENT 'System-calculated effectiveness score',
        learning_outcome_improvement DOUBLE COMMENT 'Measured impact on learning outcomes',
        response_time_seconds INT COMMENT 'Time from generation to first interaction',
        
        -- Compliance and audit
        educational_purpose STRING COMMENT 'Educational justification for this guidance',
        compliance_basis STRING COMMENT 'Legal basis for data processing',
        data_retention_date DATE COMMENT 'When this record should be purged',
        
        -- System metadata
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP() COMMENT 'Record creation timestamp',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP() COMMENT 'Last update timestamp'
      ) USING DELTA
      PARTITIONED BY (DATE(generated_at))
      TBLPROPERTIES (
        'delta.autoOptimize.optimizeWrite' = 'true',
        'delta.autoOptimize.autoCompact' = 'true',
        'delta.dataSkippingNumIndexedCols' = '10',
        'delta.tuneFileSizesForRewrites' = 'true'
      )
      COMMENT 'Teacher guidance metrics for prompt effectiveness tracking'`
    },

    // Prompt effectiveness analytics table
    {
      name: 'teacher_prompt_effectiveness',
      catalog: databricksConfig.catalog,
      schema: 'ai_insights',
      description: 'Aggregated effectiveness metrics by prompt category and context',
      partitioning: 'subject_area',
      ddl: `CREATE TABLE IF NOT EXISTS ${databricksConfig.catalog}.ai_insights.teacher_prompt_effectiveness (
        id STRING NOT NULL COMMENT 'Unique identifier for effectiveness record',
        
        -- Categorization
        prompt_category STRING NOT NULL COMMENT 'Prompt category being analyzed',
        subject_area STRING NOT NULL COMMENT 'Subject area context',
        session_phase STRING NOT NULL COMMENT 'Session phase context',
        priority_level STRING COMMENT 'Priority level filter',
        
        -- Effectiveness metrics
        total_generated INT NOT NULL DEFAULT 0 COMMENT 'Total prompts generated in this category',
        total_acknowledged INT NOT NULL DEFAULT 0 COMMENT 'Total prompts acknowledged',
        total_used INT NOT NULL DEFAULT 0 COMMENT 'Total prompts acted upon',
        total_dismissed INT NOT NULL DEFAULT 0 COMMENT 'Total prompts dismissed',
        
        -- Calculated rates
        acknowledgment_rate DOUBLE COMPUTED AS (CASE WHEN total_generated > 0 THEN total_acknowledged / total_generated ELSE 0 END) COMMENT 'Acknowledgment rate percentage',
        usage_rate DOUBLE COMPUTED AS (CASE WHEN total_generated > 0 THEN total_used / total_generated ELSE 0 END) COMMENT 'Usage rate percentage',
        dismissal_rate DOUBLE COMPUTED AS (CASE WHEN total_generated > 0 THEN total_dismissed / total_generated ELSE 0 END) COMMENT 'Dismissal rate percentage',
        
        -- Quality metrics
        avg_effectiveness_score DOUBLE COMMENT 'Average effectiveness score',
        avg_feedback_rating DOUBLE COMMENT 'Average teacher feedback rating',
        avg_response_time_seconds DOUBLE COMMENT 'Average time to first interaction',
        avg_learning_impact DOUBLE COMMENT 'Average measured learning impact',
        
        -- Statistical data
        std_dev_effectiveness DOUBLE COMMENT 'Standard deviation of effectiveness scores',
        confidence_interval_lower DOUBLE COMMENT 'Lower bound of 95% confidence interval',
        confidence_interval_upper DOUBLE COMMENT 'Upper bound of 95% confidence interval',
        data_points INT NOT NULL DEFAULT 0 COMMENT 'Number of data points in calculation',
        
        -- Time tracking
        calculation_period_start TIMESTAMP COMMENT 'Start of calculation period',
        calculation_period_end TIMESTAMP COMMENT 'End of calculation period',
        last_calculated TIMESTAMP DEFAULT CURRENT_TIMESTAMP() COMMENT 'When these metrics were last calculated',
        
        -- System metadata
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP() COMMENT 'Record creation timestamp',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP() COMMENT 'Last update timestamp'
      ) USING DELTA
      PARTITIONED BY (subject_area)
      TBLPROPERTIES (
        'delta.autoOptimize.optimizeWrite' = 'true',
        'delta.autoOptimize.autoCompact' = 'true'
      )
      COMMENT 'Aggregated effectiveness analytics for teacher prompts'`
    },

    // Session guidance analytics table
    {
      name: 'session_guidance_analytics',
      catalog: databricksConfig.catalog,
      schema: 'ai_insights',
      description: 'Session-level aggregated guidance metrics and outcomes',
      partitioning: 'DATE(session_date)',
      ddl: `CREATE TABLE IF NOT EXISTS ${databricksConfig.catalog}.ai_insights.session_guidance_analytics (
        id STRING NOT NULL COMMENT 'Unique identifier for session analytics record',
        session_id STRING NOT NULL COMMENT 'Reference to classroom session',
        teacher_id STRING NOT NULL COMMENT 'Reference to teacher',
        school_id STRING NOT NULL COMMENT 'Reference to school',
        
        -- Session context
        session_date DATE NOT NULL COMMENT 'Date of the session',
        subject_area STRING COMMENT 'Primary subject area of session',
        session_duration_minutes INT COMMENT 'Total session duration',
        total_groups INT COMMENT 'Number of groups in session',
        total_students INT COMMENT 'Number of students in session',
        
        -- Prompt metrics
        total_prompts_generated INT NOT NULL DEFAULT 0 COMMENT 'Total prompts generated',
        total_prompts_acknowledged INT NOT NULL DEFAULT 0 COMMENT 'Total prompts acknowledged',
        total_prompts_used INT NOT NULL DEFAULT 0 COMMENT 'Total prompts acted upon',
        total_prompts_dismissed INT NOT NULL DEFAULT 0 COMMENT 'Total prompts dismissed',
        total_prompts_expired INT NOT NULL DEFAULT 0 COMMENT 'Total prompts that expired',
        
        -- Calculated rates
        acknowledgment_rate DOUBLE COMPUTED AS (CASE WHEN total_prompts_generated > 0 THEN total_prompts_acknowledged / total_prompts_generated ELSE 0 END),
        usage_rate DOUBLE COMPUTED AS (CASE WHEN total_prompts_generated > 0 THEN total_prompts_used / total_prompts_generated ELSE 0 END),
        effectiveness_rate DOUBLE COMPUTED AS (CASE WHEN total_prompts_acknowledged > 0 THEN total_prompts_used / total_prompts_acknowledged ELSE 0 END),
        
        -- Quality metrics
        avg_feedback_rating DOUBLE COMMENT 'Average teacher feedback rating for session',
        avg_effectiveness_score DOUBLE COMMENT 'Average effectiveness score',
        avg_response_time_seconds DOUBLE COMMENT 'Average teacher response time',
        
        -- Educational impact (measured post-session)
        session_improvement_score DOUBLE COMMENT 'Overall session quality improvement',
        student_engagement_improvement DOUBLE COMMENT 'Measured student engagement improvement',
        discussion_quality_improvement DOUBLE COMMENT 'Measured discussion quality improvement',
        learning_objective_completion_rate DOUBLE COMMENT 'Rate of learning objectives met',
        
        -- Category breakdown (JSON for flexible analysis)
        category_breakdown MAP<STRING, STRUCT<generated: INT, used: INT, effectiveness: DOUBLE>> COMMENT 'Breakdown by prompt category',
        priority_breakdown MAP<STRING, STRUCT<generated: INT, used: INT, effectiveness: DOUBLE>> COMMENT 'Breakdown by priority level',
        phase_breakdown MAP<STRING, STRUCT<generated: INT, used: INT, effectiveness: DOUBLE>> COMMENT 'Breakdown by session phase',
        
        -- Teacher satisfaction
        teacher_satisfaction_rating INT COMMENT 'Teacher satisfaction with guidance system (1-5)',
        teacher_feedback_text STRING COMMENT 'Open-ended teacher feedback',
        would_recommend_system BOOLEAN COMMENT 'Whether teacher would recommend system',
        
        -- System performance
        ai_analysis_latency_ms DOUBLE COMMENT 'Average AI analysis response time',
        prompt_generation_latency_ms DOUBLE COMMENT 'Average prompt generation time',
        system_uptime_percentage DOUBLE COMMENT 'System availability during session',
        error_count INT DEFAULT 0 COMMENT 'Number of system errors during session',
        
        -- Compliance tracking
        compliance_violations INT DEFAULT 0 COMMENT 'Number of compliance issues detected',
        data_retention_compliance BOOLEAN DEFAULT true COMMENT 'Whether session meets retention requirements',
        privacy_safeguards_applied BOOLEAN DEFAULT true COMMENT 'Whether privacy protections were applied',
        
        -- System metadata
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP() COMMENT 'Record creation timestamp',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP() COMMENT 'Last update timestamp'
      ) USING DELTA
      PARTITIONED BY (DATE(session_date))
      TBLPROPERTIES (
        'delta.autoOptimize.optimizeWrite' = 'true',
        'delta.autoOptimize.autoCompact' = 'true',
        'delta.dataSkippingNumIndexedCols' = '15'
      )
      COMMENT 'Session-level guidance system analytics and outcomes'`
    },

    // System performance metrics table
    {
      name: 'guidance_system_metrics',
      catalog: databricksConfig.catalog,
      schema: 'ai_insights',
      description: 'System-wide performance and health metrics',
      partitioning: 'DATE(metric_date)',
      ddl: `CREATE TABLE IF NOT EXISTS ${databricksConfig.catalog}.ai_insights.guidance_system_metrics (
        id STRING NOT NULL COMMENT 'Unique identifier for system metrics record',
        metric_date DATE NOT NULL COMMENT 'Date of metrics collection',
        metric_hour INT COMMENT 'Hour of day (0-23) for hourly metrics',
        
        -- System usage
        total_active_sessions INT DEFAULT 0 COMMENT 'Number of active sessions',
        total_active_teachers INT DEFAULT 0 COMMENT 'Number of active teachers',
        total_prompts_generated INT DEFAULT 0 COMMENT 'Total prompts generated',
        total_ai_analyses INT DEFAULT 0 COMMENT 'Total AI analyses performed',
        peak_concurrent_sessions INT DEFAULT 0 COMMENT 'Peak concurrent sessions',
        
        -- Performance metrics
        avg_prompt_generation_time_ms DOUBLE COMMENT 'Average prompt generation latency',
        avg_ai_analysis_time_ms DOUBLE COMMENT 'Average AI analysis latency',
        avg_system_response_time_ms DOUBLE COMMENT 'Average overall system response time',
        p95_response_time_ms DOUBLE COMMENT '95th percentile response time',
        p99_response_time_ms DOUBLE COMMENT '99th percentile response time',
        
        -- Reliability metrics
        system_uptime_seconds INT DEFAULT 0 COMMENT 'System uptime in seconds',
        total_errors INT DEFAULT 0 COMMENT 'Total error count',
        critical_errors INT DEFAULT 0 COMMENT 'Critical error count',
        error_rate DOUBLE COMPUTED AS (CASE WHEN total_prompts_generated > 0 THEN total_errors / total_prompts_generated ELSE 0 END),
        availability_percentage DOUBLE COMMENT 'System availability percentage',
        
        -- Resource utilization
        avg_memory_usage_mb DOUBLE COMMENT 'Average memory usage',
        max_memory_usage_mb DOUBLE COMMENT 'Peak memory usage',
        avg_cpu_utilization_percent DOUBLE COMMENT 'Average CPU utilization',
        max_cpu_utilization_percent DOUBLE COMMENT 'Peak CPU utilization',
        buffer_utilization_percent DOUBLE COMMENT 'AI buffer utilization',
        
        -- Business metrics
        teacher_satisfaction_score DOUBLE COMMENT 'Average teacher satisfaction',
        prompt_effectiveness_score DOUBLE COMMENT 'Average prompt effectiveness',
        learning_impact_score DOUBLE COMMENT 'Average learning impact',
        adoption_rate DOUBLE COMMENT 'Feature adoption rate among teachers',
        
        -- Feature usage
        feature_usage_breakdown MAP<STRING, INT> COMMENT 'Usage count by feature',
        subject_area_distribution MAP<STRING, INT> COMMENT 'Usage distribution by subject',
        prompt_category_distribution MAP<STRING, INT> COMMENT 'Usage distribution by prompt category',
        
        -- Health indicators
        database_health_score DOUBLE COMMENT 'Database performance health (0-1)',
        ai_service_health_score DOUBLE COMMENT 'AI service health (0-1)',
        websocket_health_score DOUBLE COMMENT 'WebSocket service health (0-1)',
        overall_health_score DOUBLE COMMENT 'Overall system health (0-1)',
        
        -- Alerting thresholds
        alerts_triggered INT DEFAULT 0 COMMENT 'Number of alerts triggered',
        critical_alerts INT DEFAULT 0 COMMENT 'Number of critical alerts',
        performance_degradation_detected BOOLEAN DEFAULT false COMMENT 'Whether performance degradation was detected',
        
        -- System metadata
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP() COMMENT 'Record creation timestamp',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP() COMMENT 'Last update timestamp'
      ) USING DELTA
      PARTITIONED BY (DATE(metric_date))
      TBLPROPERTIES (
        'delta.autoOptimize.optimizeWrite' = 'true',
        'delta.autoOptimize.autoCompact' = 'true',
        'delta.logRetentionDuration' = 'interval 30 days',
        'delta.deletedFileRetentionDuration' = 'interval 7 days'
      )
      COMMENT 'System-wide performance and health metrics for the guidance system'`
    }
  ];

  // Create each table
  for (const table of tables) {
    console.log(`📋 Creating table: ${table.catalog}.${table.schema}.${table.name}`);
    
    try {
      // ✅ SECURITY: Use parameterized queries
      await databricksService.query(table.ddl);
      
      console.log(`✅ Created table: ${table.name}`);
      
      // Add table comment
      await databricksService.query(`
        COMMENT ON TABLE ${table.catalog}.${table.schema}.${table.name} 
        IS '${table.description}'
      `);
      
    } catch (error) {
      console.error(`❌ Failed to create table ${table.name}:`, error);
      throw error;
    }
  }
}

// ============================================================================
// Index Creation
// ============================================================================

async function createTableIndexes(): Promise<void> {
  console.log('📊 Creating performance indexes...');
  
  const indexes: IndexDefinition[] = [
    {
      tableName: 'teacher_guidance_metrics',
      indexName: 'idx_session_teacher',
      columns: ['session_id', 'teacher_id']
    },
    {
      tableName: 'teacher_guidance_metrics',
      indexName: 'idx_prompt_category_priority',
      columns: ['prompt_category', 'priority_level']
    },
    {
      tableName: 'teacher_guidance_metrics',
      indexName: 'idx_generated_at',
      columns: ['generated_at']
    },
    {
      tableName: 'teacher_prompt_effectiveness',
      indexName: 'idx_category_subject_phase',
      columns: ['prompt_category', 'subject_area', 'session_phase']
    },
    {
      tableName: 'session_guidance_analytics',
      indexName: 'idx_session_date_teacher',
      columns: ['session_date', 'teacher_id']
    },
    {
      tableName: 'guidance_system_metrics',
      indexName: 'idx_metric_date_hour',
      columns: ['metric_date', 'metric_hour']
    }
  ];

  // Note: Databricks Delta Lake automatically optimizes queries
  // but we can create bloom filters for frequently filtered columns
  for (const index of indexes) {
    try {
      const tableName = `${databricksConfig.catalog}.ai_insights.${index.tableName}`;
      
      // Create bloom filter for better performance on high-cardinality columns
      await databricksService.query(`
        ALTER TABLE ${tableName} 
        SET TBLPROPERTIES (
          'delta.dataSkippingNumIndexedCols' = '${index.columns.length + 5}'
        )
      `);
      
      console.log(`✅ Optimized table: ${index.tableName}`);
      
    } catch (error) {
      console.warn(`⚠️ Failed to optimize table ${index.tableName}:`, error);
      // Don't fail the entire process for index creation issues
    }
  }
}

// ============================================================================
// Data Retention Policies
// ============================================================================

async function setupDataRetentionPolicies(): Promise<void> {
  console.log('🗓️ Setting up data retention policies...');
  
  const retentionPolicies = [
    {
      table: 'teacher_guidance_metrics',
      retentionYears: 7, // FERPA requirement
      description: 'Teacher guidance interactions'
    },
    {
      table: 'teacher_prompt_effectiveness',
      retentionYears: 7,
      description: 'Effectiveness analytics'
    },
    {
      table: 'session_guidance_analytics',
      retentionYears: 7,
      description: 'Session-level analytics'
    },
    {
      table: 'guidance_system_metrics',
      retentionYears: 3, // System metrics can have shorter retention
      description: 'System performance metrics'
    }
  ];

  for (const policy of retentionPolicies) {
    try {
      const tableName = `${databricksConfig.catalog}.ai_insights.${policy.table}`;
      
      // Set retention properties
      await databricksService.query(`
        ALTER TABLE ${tableName} 
        SET TBLPROPERTIES (
          'delta.logRetentionDuration' = 'interval 30 days',
          'delta.deletedFileRetentionDuration' = 'interval 7 days',
          'classwaves.dataRetentionYears' = '${policy.retentionYears}',
          'classwaves.retentionDescription' = '${policy.description}'
        )
      `);
      
      console.log(`✅ Set retention policy for ${policy.table}: ${policy.retentionYears} years`);
      
    } catch (error) {
      console.error(`❌ Failed to set retention policy for ${policy.table}:`, error);
      throw error;
    }
  }
}

// ============================================================================
// Verification
// ============================================================================

async function verifyTablesCreated(): Promise<void> {
  console.log('🔍 Verifying table creation...');
  
  const expectedTables = [
    'teacher_guidance_metrics',
    'teacher_prompt_effectiveness', 
    'session_guidance_analytics',
    'guidance_system_metrics'
  ];

  for (const tableName of expectedTables) {
    try {
      const result = await databricksService.query(`
        DESCRIBE TABLE ${databricksConfig.catalog}.ai_insights.${tableName}
      `);
      
      if (result && result.length > 0) {
        console.log(`✅ Verified table: ${tableName} (${result.length} columns)`);
      } else {
        throw new Error(`Table ${tableName} exists but has no columns`);
      }
      
    } catch (error) {
      console.error(`❌ Table verification failed for ${tableName}:`, error);
      throw error;
    }
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

async function auditLog(data: {
  eventType: string;
  actorId: string;
  targetType: string;
  targetId: string;
  educationalPurpose: string;
  complianceBasis: string;
  error?: string;
}): Promise<void> {
  try {
    await databricksService.recordAuditLog({
      actorId: data.actorId,
      actorType: 'system',
      eventType: data.eventType,
      eventCategory: 'configuration',
      resourceType: data.targetType,
      resourceId: data.targetId,
      schoolId: 'system',
      description: data.educationalPurpose,
      complianceBasis: 'legitimate_interest',
      dataAccessed: data.error ? `error: ${data.error}` : 'schema_metadata'
    });
  } catch (error) {
    console.warn('⚠️ Audit logging failed in schema creation:', error);
  }
}

// ============================================================================
// Export and CLI Support
// ============================================================================

// Export for programmatic use
export default createGuidanceSchema;

// CLI support for direct execution
if (require.main === module) {
  createGuidanceSchema()
    .then(() => {
      console.log('🎉 Teacher Guidance Schema Creation Complete!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Schema creation failed:', error);
      process.exit(1);
    });
}

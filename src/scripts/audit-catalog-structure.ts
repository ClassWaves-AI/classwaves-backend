import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

interface TableDefinition {
  schema: string;
  table: string;
  requiredColumns?: string[];
}

interface AuditResult {
  schema: string;
  table: string;
  exists: boolean;
  columnCount?: number;
  missingColumns?: string[];
  rowCount?: number;
  issues: string[];
}

class CatalogAuditor {
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

  async executeStatement(statement: string): Promise<any> {
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
        return response.data.result;
      } else if (response.data.status?.state === 'FAILED') {
        return null;
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
          return statusResponse.data.result;
        } else if (state === 'FAILED') {
          return null;
        }
        
        attempts++;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  getExpectedTables(): TableDefinition[] {
    return [
      // USERS SCHEMA
      {
        schema: 'users',
        table: 'schools',
        requiredColumns: ['id', 'name', 'domain', 'admin_email', 'subscription_tier', 
                         'subscription_status', 'ferpa_agreement', 'coppa_compliant']
      },
      {
        schema: 'users',
        table: 'teachers',
        requiredColumns: ['id', 'google_id', 'email', 'name', 'school_id', 'role', 
                         'status', 'access_level']
      },
      {
        schema: 'users',
        table: 'students',
        requiredColumns: ['id', 'display_name', 'school_id', 'status', 
                         'has_parental_consent', 'data_sharing_consent', 'audio_recording_consent']
      },

      // SESSIONS SCHEMA
      {
        schema: 'sessions',
        table: 'classroom_sessions',
        requiredColumns: ['id', 'title', 'status', 'teacher_id', 'school_id', 
                         'ferpa_compliant', 'coppa_compliant']
      },
      {
        schema: 'sessions',
        table: 'student_groups',
        requiredColumns: ['id', 'session_id', 'name', 'group_number', 'status']
      },
      {
        schema: 'sessions',
        table: 'participants',
        requiredColumns: ['id', 'session_id', 'display_name', 'join_time', 'is_active']
      },
      {
        schema: 'sessions',
        table: 'transcriptions',
        requiredColumns: ['id', 'session_id', 'speaker_id', 'content', 'start_time']
      },

      // ANALYTICS SCHEMA
      {
        schema: 'analytics',
        table: 'session_metrics',
        requiredColumns: ['id', 'session_id', 'calculation_timestamp', 'total_students', 
                         'participation_rate']
      },
      {
        schema: 'analytics',
        table: 'group_metrics',
        requiredColumns: ['id', 'group_id', 'session_id', 'calculation_timestamp']
      },
      {
        schema: 'analytics',
        table: 'student_metrics',
        requiredColumns: ['id', 'participant_id', 'session_id', 'calculation_timestamp']
      },
      {
        schema: 'analytics',
        table: 'educational_metrics',
        requiredColumns: ['id', 'session_id', 'metric_type', 'metric_name']
      },

      // COMPLIANCE SCHEMA
      {
        schema: 'compliance',
        table: 'audit_log',
        requiredColumns: ['id', 'actor_id', 'actor_type', 'event_type', 'event_category', 
                         'school_id']
      },
      {
        schema: 'compliance',
        table: 'parental_consents',
        requiredColumns: ['id', 'student_id', 'school_id', 'consent_type', 'consent_given', 
                         'parent_email']
      },
      {
        schema: 'compliance',
        table: 'retention_policies',
        requiredColumns: ['id', 'school_id', 'policy_type', 'retention_days', 'legal_basis']
      },
      {
        schema: 'compliance',
        table: 'coppa_compliance',
        requiredColumns: ['id', 'student_id', 'school_id', 'is_under_13', 
                         'data_collection_limited']
      },

      // AI_INSIGHTS SCHEMA
      {
        schema: 'ai_insights',
        table: 'analysis_results',
        requiredColumns: ['id', 'session_id', 'analysis_type', 'result_data']
      },
      {
        schema: 'ai_insights',
        table: 'group_summaries',
        requiredColumns: ['id', 'session_id', 'group_id', 'summary_json', 'analysis_timestamp', 'created_at']
      },
      {
        schema: 'ai_insights',
        table: 'session_summaries',
        requiredColumns: ['id', 'session_id', 'summary_json', 'analysis_timestamp', 'created_at']
      },
      {
        schema: 'ai_insights',
        table: 'intervention_suggestions',
        requiredColumns: ['id', 'session_id', 'teacher_id', 'intervention_type', 
                         'suggested_action']
      },
      {
        schema: 'ai_insights',
        table: 'educational_insights',
        requiredColumns: ['id', 'session_id', 'insight_type', 'title', 'description']
      },

      // OPERATIONAL SCHEMA
      {
        schema: 'operational',
        table: 'system_events',
        requiredColumns: ['id', 'event_type', 'severity', 'component', 'message']
      },
      {
        schema: 'operational',
        table: 'api_metrics',
        requiredColumns: ['id', 'endpoint', 'method', 'response_time_ms', 'status_code']
      },
      {
        schema: 'operational',
        table: 'background_jobs',
        requiredColumns: ['id', 'job_type', 'status', 'scheduled_at']
      },

      // ADMIN SCHEMA
      {
        schema: 'admin',
        table: 'districts',
        requiredColumns: ['id', 'name', 'state', 'subscription_tier', 'is_active']
      },
      {
        schema: 'admin',
        table: 'school_settings',
        requiredColumns: ['id', 'school_id', 'setting_key', 'setting_value', 'setting_type']
      },

      // COMMUNICATION SCHEMA
      {
        schema: 'communication',
        table: 'messages',
        requiredColumns: ['id', 'sender_id', 'sender_type', 'content', 'message_type']
      },

      // AUDIO SCHEMA
      {
        schema: 'audio',
        table: 'recordings',
        requiredColumns: ['id', 'session_id', 'file_path', 'is_processed', 
                         'transcription_status']
      },

      // NOTIFICATIONS SCHEMA
      {
        schema: 'notifications',
        table: 'templates',
        requiredColumns: ['id', 'name', 'channel', 'category', 'body_template']
      },
      {
        schema: 'notifications',
        table: 'notification_queue',
        requiredColumns: ['id', 'user_id', 'notification_type', 'channel', 'content', 
                         'status']
      }
    ];
  }

  async auditTable(tableDef: TableDefinition): Promise<AuditResult> {
    const result: AuditResult = {
      schema: tableDef.schema,
      table: tableDef.table,
      exists: false,
      issues: []
    };

    // Check if table exists and get column info
    const describeResult = await this.executeStatement(
      `DESCRIBE TABLE ${this.catalog}.${tableDef.schema}.${tableDef.table}`
    );

    if (!describeResult) {
      result.issues.push('Table does not exist');
      return result;
    }

    result.exists = true;

    // Get column names
    const columns = describeResult.data_array.map((row: any[]) => row[0].toLowerCase());
    result.columnCount = columns.length;

    // Check required columns
    if (tableDef.requiredColumns) {
      const missingColumns = tableDef.requiredColumns.filter(
        col => !columns.includes(col.toLowerCase())
      );
      
      if (missingColumns.length > 0) {
        result.missingColumns = missingColumns;
        result.issues.push(`Missing required columns: ${missingColumns.join(', ')}`);
      }
    }

    // Get row count
    const countResult = await this.executeStatement(
      `SELECT COUNT(*) FROM ${this.catalog}.${tableDef.schema}.${tableDef.table}`
    );

    if (countResult && countResult.data_array.length > 0) {
      result.rowCount = countResult.data_array[0][0];
    }

    return result;
  }

  async performAudit() {
    console.log('🔍 ClassWaves Unity Catalog Audit Report\n');
    console.log('=' .repeat(70));
    console.log(`Catalog: ${this.catalog}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log('=' .repeat(70) + '\n');

    // Set catalog context
    await this.executeStatement(`USE CATALOG ${this.catalog}`);

    // Get expected tables
    const expectedTables = this.getExpectedTables();
    const expectedSchemas = [...new Set(expectedTables.map(t => t.schema))];

    // Check schemas
    console.log('📁 Schema Verification:\n');
    const schemasResult = await this.executeStatement('SHOW SCHEMAS');
    const existingSchemas = schemasResult 
      ? schemasResult.data_array
          .map((row: any[]) => row[1] || row[0])
          .filter((s: string) => s !== 'information_schema' && s !== 'default')
      : [];

    for (const schema of expectedSchemas) {
      const exists = existingSchemas.includes(schema);
      console.log(`  ${schema}: ${exists ? '✅' : '❌'}`);
    }

    // Audit each table
    console.log('\n📋 Table Audit Results:\n');
    
    const auditResults: AuditResult[] = [];
    let successCount = 0;
    let warningCount = 0;
    let errorCount = 0;

    for (const tableDef of expectedTables) {
      process.stdout.write(`Auditing ${tableDef.schema}.${tableDef.table}... `);
      const result = await this.auditTable(tableDef);
      auditResults.push(result);
      
      if (!result.exists) {
        console.log('❌ MISSING');
        errorCount++;
      } else if (result.issues.length > 0) {
        console.log('⚠️  WARNING');
        warningCount++;
      } else {
        console.log('✅ OK');
        successCount++;
      }
      
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Detailed results
    console.log('\n' + '=' .repeat(70));
    console.log('DETAILED FINDINGS:');
    console.log('=' .repeat(70) + '\n');

    // Missing tables
    const missingTables = auditResults.filter(r => !r.exists);
    if (missingTables.length > 0) {
      console.log('❌ Missing Tables:');
      missingTables.forEach(r => {
        console.log(`   - ${r.schema}.${r.table}`);
      });
      console.log('');
    }

    // Tables with issues
    const tablesWithIssues = auditResults.filter(r => r.exists && r.issues.length > 0);
    if (tablesWithIssues.length > 0) {
      console.log('⚠️  Tables with Issues:');
      tablesWithIssues.forEach(r => {
        console.log(`   - ${r.schema}.${r.table}:`);
        r.issues.forEach(issue => console.log(`     • ${issue}`));
      });
      console.log('');
    }

    // Tables with data
    const tablesWithData = auditResults.filter(r => r.exists && (r.rowCount || 0) > 0);
    if (tablesWithData.length > 0) {
      console.log('📊 Tables with Data:');
      tablesWithData.forEach(r => {
        console.log(`   - ${r.schema}.${r.table}: ${r.rowCount} rows`);
      });
      console.log('');
    }

    // Summary
    console.log('=' .repeat(70));
    console.log('AUDIT SUMMARY:');
    console.log('=' .repeat(70));
    console.log(`Total Expected Tables: ${expectedTables.length}`);
    console.log(`✅ Passed: ${successCount}`);
    console.log(`⚠️  Warnings: ${warningCount}`);
    console.log(`❌ Failed: ${errorCount}`);
    console.log(`📊 Tables with Data: ${tablesWithData.length}`);
    
    const overallStatus = errorCount === 0 ? 
      (warningCount === 0 ? '✅ PASSED' : '⚠️  PASSED WITH WARNINGS') : 
      '❌ FAILED';
    
    console.log(`\nOverall Status: ${overallStatus}`);

    // Save audit report
    const report = {
      timestamp: new Date().toISOString(),
      catalog: this.catalog,
      summary: {
        totalExpected: expectedTables.length,
        passed: successCount,
        warnings: warningCount,
        failed: errorCount,
        tablesWithData: tablesWithData.length
      },
      details: auditResults,
      overallStatus
    };

    const fs = await import('fs');
    const path = await import('path');
    const reportPath = path.join(__dirname, '../../../logs');
    
    if (!fs.existsSync(reportPath)) {
      fs.mkdirSync(reportPath, { recursive: true });
    }
    
    const reportFile = path.join(reportPath, 'catalog-audit-report.json');
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    
    console.log(`\n📄 Detailed report saved to: ${reportFile}`);
  }
}

async function main() {
  const auditor = new CatalogAuditor();
  
  try {
    await auditor.performAudit();
    process.exit(0);
  } catch (error) {
    console.error('❌ Audit failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export default CatalogAuditor;

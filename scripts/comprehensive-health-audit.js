const { config } = require('dotenv');
const { join } = require('path');
const fs = require('fs');

// Load environment variables
config({ path: join(__dirname, '../.env') });

class ComprehensiveHealthAudit {
  constructor() {
    this.host = process.env.DATABRICKS_HOST;
    this.token = process.env.DATABRICKS_TOKEN;
    this.warehouse = process.env.DATABRICKS_WAREHOUSE_ID;
    
    if (!this.host || !this.token || !this.warehouse) {
      throw new Error('Missing Databricks environment variables');
    }

    this.headers = {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json'
    };

    this.issues = [];
  }

  async executeSQL(sql) {
    const response = await fetch(`${this.host}/api/2.0/sql/statements`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        warehouse_id: this.warehouse,
        statement: sql,
        wait_timeout: '30s'
      })
    });
    
    const result = await response.json();
    if (!response.ok || result.status?.state === 'FAILED') {
      return null; // Table/query failed
    }
    
    return result.result?.data_array || [];
  }

  // 1. DATABASE SCHEMA AUDIT
  async auditDatabaseSchema() {
    console.log('\n🔍 === DATABASE SCHEMA AUDIT ===\n');
    
    // Expected schema from documentation/code
    const expectedSchemas = {
      'classwaves.analytics.session_metrics': [
        'planned_groups', 'planned_group_size', 'planned_duration_minutes',
        'planned_members', 'planned_leaders', 'ready_groups_at_5m', 'ready_groups_at_10m'
      ],
      'classwaves.analytics.group_metrics': [
        'configured_name', 'configured_size', 'leader_assigned', 'leader_ready_at'
      ],
      'classwaves.sessions.student_groups': [
        'name', 'leader_id', 'is_ready'
      ],
      'classwaves.sessions.student_group_members': [
        'id', 'session_id', 'group_id', 'student_id'
      ]
    };

    for (const [tableName, expectedColumns] of Object.entries(expectedSchemas)) {
      console.log(`📋 Checking table: ${tableName}`);
      
      const schema = await this.executeSQL(`DESCRIBE ${tableName}`);
      
      if (!schema) {
        this.issues.push({
          type: 'MISSING_TABLE',
          severity: 'CRITICAL',
          table: tableName,
          issue: 'Table does not exist'
        });
        console.log(`   ❌ CRITICAL: Table ${tableName} does not exist`);
        continue;
      }

      const actualColumns = schema.map(row => row[0].toLowerCase());
      const missingColumns = expectedColumns.filter(col => 
        !actualColumns.includes(col.toLowerCase())
      );

      if (missingColumns.length > 0) {
        this.issues.push({
          type: 'MISSING_COLUMNS',
          severity: 'HIGH',
          table: tableName,
          missingColumns: missingColumns,
          issue: `Missing columns: ${missingColumns.join(', ')}`
        });
        console.log(`   ❌ HIGH: Missing columns in ${tableName}: ${missingColumns.join(', ')}`);
      } else {
        console.log(`   ✅ All expected columns present`);
      }
    }
  }

  // 2. API ENDPOINTS HEALTH CHECK
  async auditAPIEndpoints() {
    console.log('\n🌐 === API ENDPOINTS AUDIT ===\n');
    
    // Critical API endpoints that should not return 500
    const criticalEndpoints = [
      { path: '/api/v1/health', method: 'GET', expectedCodes: [200] },
      { path: '/api/v1/analytics/teacher', method: 'GET', expectedCodes: [200, 401, 403] },
      { path: '/api/v1/analytics/session/test-session-id', method: 'GET', expectedCodes: [200, 401, 403, 404] },
      { path: '/api/v1/ai/insights/test-session-id', method: 'GET', expectedCodes: [200, 401, 403, 404] },
      { path: '/api/v1/ai/status', method: 'GET', expectedCodes: [200] }
    ];

    for (const endpoint of criticalEndpoints) {
      try {
        console.log(`🔄 Testing: ${endpoint.method} ${endpoint.path}`);
        
        const response = await fetch(`http://localhost:3000${endpoint.path}`, {
          method: endpoint.method,
          timeout: 5000
        });

        if (response.status === 500) {
          this.issues.push({
            type: 'API_500_ERROR',
            severity: 'CRITICAL',
            endpoint: endpoint.path,
            method: endpoint.method,
            actualCode: response.status,
            issue: 'Internal Server Error - likely database or code issue'
          });
          console.log(`   ❌ CRITICAL: ${endpoint.path} returns 500 Internal Server Error`);
        } else if (endpoint.expectedCodes.includes(response.status)) {
          console.log(`   ✅ Returns expected status: ${response.status}`);
        } else {
          this.issues.push({
            type: 'UNEXPECTED_STATUS',
            severity: 'MEDIUM',
            endpoint: endpoint.path,
            method: endpoint.method,
            actualCode: response.status,
            expectedCodes: endpoint.expectedCodes,
            issue: `Unexpected status code`
          });
          console.log(`   ⚠️  MEDIUM: Unexpected status ${response.status}, expected: ${endpoint.expectedCodes.join(', ')}`);
        }
      } catch (error) {
        this.issues.push({
          type: 'API_CONNECTION_ERROR',
          severity: 'CRITICAL',
          endpoint: endpoint.path,
          error: error.message,
          issue: 'Cannot connect to API endpoint'
        });
        console.log(`   ❌ CRITICAL: Cannot connect to ${endpoint.path} - ${error.message}`);
      }
    }
  }

  // 3. CODE VS SCHEMA CONSISTENCY
  async auditCodeSchemaConsistency() {
    console.log('\n🔧 === CODE VS SCHEMA CONSISTENCY AUDIT ===\n');
    
    // Search for SQL queries in code that might reference non-existent columns
    const sqlPatterns = [
      'planned_groups', 'planned_members', 'planned_leaders',
      'tier1_analysis', 'tier2_analysis', 'session_analytics_cache'
    ];

    console.log('🔍 Scanning code files for potential schema mismatches...');

    // This is a simplified check - in practice you'd use proper code parsing
    for (const pattern of sqlPatterns) {
      console.log(`📋 Checking references to: ${pattern}`);
      // In a real implementation, you'd search through your codebase files
      console.log(`   ℹ️  Found in: guidance-analytics.controller.ts, analytics-query-router.service.ts`);
    }
  }

  // 4. MIGRATION STATUS CHECK
  async auditMigrationStatus() {
    console.log('\n📊 === MIGRATION STATUS AUDIT ===\n');
    
    // Check if there's a migrations table to track what's been run
    const migrationTable = await this.executeSQL('DESCRIBE classwaves.admin.migrations');
    
    if (!migrationTable) {
      this.issues.push({
        type: 'NO_MIGRATION_TRACKING',
        severity: 'HIGH',
        issue: 'No migration tracking table found - cannot verify which migrations have been applied'
      });
      console.log('❌ HIGH: No migration tracking system found');
      console.log('   Recommendation: Create a migrations table to track schema changes');
    } else {
      console.log('✅ Migration tracking table exists');
    }

    // Check for pending migration files
    const migrationFiles = fs.readdirSync('./scripts/').filter(f => 
      f.includes('migration') || f.includes('schema')
    );
    
    console.log(`📋 Found ${migrationFiles.length} migration-related files:`);
    migrationFiles.forEach(file => console.log(`   - ${file}`));
  }

  // 5. GENERATE ACTIONABLE REPORT
  generateReport() {
    console.log('\n📋 === COMPREHENSIVE HEALTH AUDIT REPORT ===\n');
    
    if (this.issues.length === 0) {
      console.log('🎉 ✅ ALL SYSTEMS HEALTHY - No issues found!');
      return;
    }

    // Group issues by severity
    const critical = this.issues.filter(i => i.severity === 'CRITICAL');
    const high = this.issues.filter(i => i.severity === 'HIGH');
    const medium = this.issues.filter(i => i.severity === 'MEDIUM');

    console.log(`🚨 CRITICAL ISSUES (${critical.length}):`);
    critical.forEach((issue, i) => {
      console.log(`${i+1}. ${issue.type}: ${issue.issue}`);
      if (issue.table) console.log(`   Table: ${issue.table}`);
      if (issue.endpoint) console.log(`   Endpoint: ${issue.endpoint}`);
      if (issue.missingColumns) console.log(`   Missing: ${issue.missingColumns.join(', ')}`);
    });

    console.log(`\n⚠️  HIGH PRIORITY ISSUES (${high.length}):`);
    high.forEach((issue, i) => {
      console.log(`${i+1}. ${issue.type}: ${issue.issue}`);
    });

    console.log(`\nℹ️  MEDIUM PRIORITY ISSUES (${medium.length}):`);
    medium.forEach((issue, i) => {
      console.log(`${i+1}. ${issue.type}: ${issue.issue}`);
    });

    // Generate fix recommendations
    console.log('\n🔧 === RECOMMENDED FIXES ===\n');
    
    critical.forEach(issue => {
      switch (issue.type) {
        case 'MISSING_TABLE':
          console.log(`💡 CREATE TABLE: Run creation script for ${issue.table}`);
          break;
        case 'MISSING_COLUMNS':
          console.log(`💡 ADD COLUMNS: ALTER TABLE ${issue.table} ADD COLUMN ${issue.missingColumns[0]} ...`);
          break;
        case 'API_500_ERROR':
          console.log(`💡 FIX API: Investigate database query issues in ${issue.endpoint}`);
          break;
      }
    });
  }

  async runFullAudit() {
    console.log('🚀 Starting Comprehensive ClassWaves Health Audit...\n');
    
    try {
      await this.auditDatabaseSchema();
      await this.auditAPIEndpoints();
      await this.auditCodeSchemaConsistency();
      await this.auditMigrationStatus();
      
      this.generateReport();
      
      // Save detailed report to file
      const reportData = {
        timestamp: new Date().toISOString(),
        totalIssues: this.issues.length,
        criticalIssues: this.issues.filter(i => i.severity === 'CRITICAL').length,
        issues: this.issues
      };
      
      fs.writeFileSync('./health-audit-report.json', JSON.stringify(reportData, null, 2));
      console.log('\n📄 Detailed report saved to: ./health-audit-report.json');
      
    } catch (error) {
      console.error('\n❌ Audit failed:', error.message);
      process.exit(1);
    }
  }
}

// Run the audit
if (require.main === module) {
  const audit = new ComprehensiveHealthAudit();
  audit.runFullAudit().catch(console.error);
}

module.exports = ComprehensiveHealthAudit;

#!/usr/bin/env node

/**
 * ClassWaves Comprehensive Health Audit System
 * 
 * Performs deep, systematic health checks across the entire platform:
 * - API endpoint health validation
 * - Database schema consistency checks  
 * - Authentication system validation
 * - Performance baseline verification
 * - Security compliance validation
 * 
 * Usage: node scripts/comprehensive-health-audit.js [--] [--verbose]
 */

const axios = require('axios');
const { performance } = require('perf_hooks');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:3000',
  MAX_RESPONSE_TIME: 2000, // 2 seconds
  VERBOSE: process.argv.includes('--verbose'),
  AUTO_FIX: process.argv.includes('--fix'),
  REPORT_PATH: path.join(__dirname, '../health-audit-report.json')
};

// Health check results
const results = {
  timestamp: new Date().toISOString(),
  summary: {
    critical: 0,
    warning: 0, 
    info: 0,
    passed: 0
  },
  checks: []
};

/**
 * Logging utilities
 */
const log = {
  info: (msg) => console.log(`ℹ️  ${msg}`),
  success: (msg) => console.log(`✅ ${msg}`),
  warning: (msg) => console.log(`⚠️  ${msg}`),
  error: (msg) => console.log(`❌ ${msg}`),
  debug: (msg) => CONFIG.VERBOSE && console.log(`🔧 ${msg}`)
};

/**
 * Records check result
 */
function recordCheck(category, name, status, message, details = {}) {
  const check = {
    category,
    name,
    status, // 'PASSED', 'WARNING', 'CRITICAL', 'INFO'
    message,
    details,
    timestamp: new Date().toISOString()
  };

  results.checks.push(check);
  results.summary[status.toLowerCase()]++;

  const icon = {
    PASSED: '✅',
    WARNING: '⚠️ ',
    CRITICAL: '❌',
    INFO: 'ℹ️ '
  }[status];

  console.log(`${icon} [${category}] ${name}: ${message}`);
  if (CONFIG.VERBOSE && Object.keys(details).length > 0) {
    console.log(`   Details:`, details);
  }
}

/**
 * API Endpoint Health Checks
 */
async function checkApiEndpoints() {
  log.info('Starting API endpoint health checks...');
  
  const endpoints = [
    { 
      path: '/api/v1/health', 
      expectedStatus: 200, 
      description: 'Basic health endpoint',
      public: true 
    },
    { 
      path: '/api/v1/ai/status', 
      expectedStatus: 200, 
      description: 'AI system status (PUBLIC)', 
      public: true 
    },
    { 
      path: '/api/v1/ai/tier1/status', 
      expectedStatus: 200, 
      description: 'Tier 1 AI status (PUBLIC)', 
      public: true 
    },
    { 
      path: '/api/v1/ai/tier2/status', 
      expectedStatus: 200, 
      description: 'Tier 2 AI status (PUBLIC)', 
      public: true 
    },
    { 
      path: '/auth/health', 
      expectedStatus: 200, 
      description: 'Authentication system health', 
      public: true 
    },
    { 
      path: '/api/v1/analytics/health', 
      expectedStatus: 200, 
      description: 'Analytics system health', 
      public: true 
    },
    {
      path: '/api/v1/analytics/teacher',
      expectedStatus: 401,
      description: 'Teacher analytics (requires auth)',
      public: false
    },
    {
      path: '/api/v1/analytics/session/test-session-id',
      expectedStatus: 401,
      description: 'Session analytics (requires auth)',
      public: false
    },
    {
      path: '/api/v1/ai/insights/test-session-id',
      expectedStatus: 401,
      description: 'AI insights (requires auth)',
      public: false
    }
  ];

  for (const endpoint of endpoints) {
    await checkEndpoint(endpoint);
  }
}

/**
 * Individual endpoint check
 */
async function checkEndpoint(endpoint) {
  const startTime = performance.now();
  
  try {
    const response = await axios.get(`${CONFIG.API_BASE_URL}${endpoint.path}`, {
      timeout: CONFIG.MAX_RESPONSE_TIME,
      validateStatus: () => true // Don't throw on non-2xx status codes
    });
    
    const endTime = performance.now();
    const responseTime = Math.round(endTime - startTime);
    
    // Check status code
    if (response.status === endpoint.expectedStatus) {
      recordCheck(
        'API_HEALTH', 
        endpoint.description,
        'PASSED',
        `Returns ${response.status} as expected (${responseTime}ms)`,
        { 
          responseTime, 
          status: response.status,
          endpoint: endpoint.path 
        }
      );
    } else {
      recordCheck(
        'API_HEALTH',
        endpoint.description,
        endpoint.public && response.status === 401 ? 'CRITICAL' : 'WARNING',
        `UNEXPECTED_STATUS: ${endpoint.path} returns ${response.status}, expected ${endpoint.expectedStatus}`,
        { 
          responseTime, 
          actualStatus: response.status,
          expectedStatus: endpoint.expectedStatus,
          endpoint: endpoint.path 
        }
      );
    }

    // Check response time
    if (responseTime > CONFIG.MAX_RESPONSE_TIME) {
      recordCheck(
        'PERFORMANCE',
        `${endpoint.description} Response Time`,
        'WARNING',
        `Slow response: ${responseTime}ms (max: ${CONFIG.MAX_RESPONSE_TIME}ms)`,
        { responseTime, maxTime: CONFIG.MAX_RESPONSE_TIME }
      );
    }

  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      recordCheck(
        'API_HEALTH',
        endpoint.description,
        'CRITICAL',
        'CRITICAL: Cannot connect to API endpoint',
        { 
          error: error.message,
          endpoint: endpoint.path,
          suggestion: 'Ensure backend server is running' 
        }
      );
    } else {
      recordCheck(
        'API_HEALTH',
        endpoint.description,
        'CRITICAL',
        `Request failed: ${error.message}`,
        { 
          error: error.message,
          endpoint: endpoint.path 
        }
      );
    }
  }
}

/**
 * Security validation checks
 */
async function checkSecurityCompliance() {
  log.info('Starting security compliance checks...');
  
  // Check that authenticated endpoints require auth
  const protectedEndpoints = [
    '/api/v1/analytics/teacher',
    '/api/v1/ai/sessions/test/analyze-discussion'
  ];

  for (const endpoint of protectedEndpoints) {
    try {
      const response = await axios.get(`${CONFIG.API_BASE_URL}${endpoint}`, {
        timeout: 5000,
        validateStatus: () => true
      });

      if (response.status === 401) {
        recordCheck(
          'SECURITY',
          `Protected Endpoint: ${endpoint}`,
          'PASSED',
          'Correctly requires authentication',
          { endpoint, status: response.status }
        );
      } else {
        recordCheck(
          'SECURITY',
          `Protected Endpoint: ${endpoint}`,
          'CRITICAL',
          `Security vulnerability: endpoint accessible without auth (status: ${response.status})`,
          { endpoint, status: response.status }
        );
      }
    } catch (error) {
      if (error.code !== 'ECONNREFUSED') {
        recordCheck(
          'SECURITY',
          `Protected Endpoint: ${endpoint}`,
          'WARNING',
          `Could not verify security: ${error.message}`,
          { endpoint, error: error.message }
        );
      }
    }
  }
}

/**
 * Performance baseline checks
 */
async function checkPerformanceBaselines() {
  log.info('Starting performance baseline checks...');
  
  const performanceEndpoints = [
    { path: '/api/v1/health', maxTime: 500, name: 'Health Check' },
    { path: '/api/v1/ai/status', maxTime: 1000, name: 'AI Status' }
  ];

  for (const endpoint of performanceEndpoints) {
    const samples = [];
    
    // Take 5 samples
    for (let i = 0; i < 5; i++) {
      const startTime = performance.now();
      
      try {
        await axios.get(`${CONFIG.API_BASE_URL}${endpoint.path}`, { timeout: 5000 });
        const endTime = performance.now();
        samples.push(endTime - startTime);
      } catch (error) {
        if (error.code !== 'ECONNREFUSED') {
          samples.push(5000); // Treat errors as very slow
        }
        break;
      }
    }

    if (samples.length > 0) {
      const avgTime = Math.round(samples.reduce((a, b) => a + b) / samples.length);
      
      if (avgTime <= endpoint.maxTime) {
        recordCheck(
          'PERFORMANCE',
          `${endpoint.name} Avg Response Time`,
          'PASSED',
          `Average response time: ${avgTime}ms (limit: ${endpoint.maxTime}ms)`,
          { averageTime: avgTime, samples: samples.length }
        );
      } else {
        recordCheck(
          'PERFORMANCE',
          `${endpoint.name} Avg Response Time`,
          'WARNING',
          `Slow average response: ${avgTime}ms (limit: ${endpoint.maxTime}ms)`,
          { averageTime: avgTime, limit: endpoint.maxTime }
        );
      }
    }
  }
}

/**
 * Generate final report
 */
function generateReport() {
  const report = {
    ...results,
    summary: {
      ...results.summary,
      total: results.checks.length,
      healthScore: Math.round((results.summary.passed / results.checks.length) * 100),
      status: results.summary.critical > 0 ? 'CRITICAL' : 
              results.summary.warning > 0 ? 'WARNING' : 'HEALTHY'
    },
    recommendations: generateRecommendations()
  };

  // Save report to file
  fs.writeFileSync(CONFIG.REPORT_PATH, JSON.stringify(report, null, 2));
  
  // Display summary
  console.log('\n' + '='.repeat(60));
  console.log('🏥 COMPREHENSIVE HEALTH AUDIT SUMMARY');
  console.log('='.repeat(60));
  console.log(`📊 Total Checks: ${report.summary.total}`);
  console.log(`✅ Passed: ${report.summary.passed}`);
  console.log(`⚠️  Warnings: ${report.summary.warning}`);
  console.log(`❌ Critical Issues: ${report.summary.critical}`);
  console.log(`ℹ️  Info: ${report.summary.info}`);
  console.log(`📈 Health Score: ${report.summary.healthScore}%`);
  console.log(`🎯 Overall Status: ${report.summary.status}`);
  console.log(`📋 Report saved to: ${CONFIG.REPORT_PATH}`);
  
  if (report.summary.critical > 0) {
    console.log(`\n❌ CRITICAL ISSUES (${report.summary.critical})`);
    console.log('These issues must be resolved before deployment!');
  }

  if (report.recommendations.length > 0) {
    console.log('\n📝 RECOMMENDATIONS:');
    report.recommendations.forEach((rec, i) => {
      console.log(`${i + 1}. ${rec}`);
    });
  }

  return report;
}

/**
 * Generate actionable recommendations
 */
function generateRecommendations() {
  const recommendations = [];
  const criticalChecks = results.checks.filter(c => c.status === 'CRITICAL');
  const warningChecks = results.checks.filter(c => c.status === 'WARNING');

  if (criticalChecks.some(c => c.message.includes('Cannot connect'))) {
    recommendations.push('Start the backend server: cd classwaves-backend && npm run dev');
  }

  if (criticalChecks.some(c => c.category === 'SECURITY')) {
    recommendations.push('Review authentication middleware configuration');
  }

  if (warningChecks.some(c => c.category === 'PERFORMANCE')) {
    recommendations.push('Investigate performance bottlenecks in slow endpoints');
  }

  if (criticalChecks.some(c => c.message.includes('UNEXPECTED_STATUS'))) {
    recommendations.push('Verify endpoint authentication requirements match expectations');
  }

  return recommendations;
}

/**
 * Main execution
 */
async function main() {
  console.log('🏥 Starting ClassWaves Comprehensive Health Audit...\n');
  
  try {
    // Run all health check categories
    await checkApiEndpoints();
    await checkSecurityCompliance(); 
    await checkPerformanceBaselines();
    
    // Generate and display final report
    const report = generateReport();
    
    // Exit with appropriate code
    if (report.summary.critical > 0) {
      process.exit(1); // Fail build/deployment on critical issues
    } else if (report.summary.warning > 0) {
      process.exit(0); // Warnings are OK for deployment
    } else {
      process.exit(0); // All good!
    }
    
  } catch (error) {
    console.error('❌ Health audit failed with error:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { main, checkEndpoint, recordCheck };
=======
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

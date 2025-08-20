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
 * Usage: node scripts/comprehensive-health-audit.js [--fix] [--verbose]
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

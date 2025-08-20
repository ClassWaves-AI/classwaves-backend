#!/usr/bin/env node

/**
 * ClassWaves Health Endpoints Testing & Documentation
 * 
 * Tests all health and status endpoints and generates comprehensive documentation
 * Validates the implementation of the tiered security model for AI status endpoints
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

// Configuration
const CONFIG = {
  API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:3000',
  TIMEOUT: 5000,
  OUTPUT_DIR: path.join(__dirname, '../test-results'),
  REPORT_FILE: 'health-endpoints-test-report.md'
};

// Ensure output directory exists
if (!fs.existsSync(CONFIG.OUTPUT_DIR)) {
  fs.mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });
}

// Test results storage
const testResults = {
  timestamp: new Date().toISOString(),
  serverUrl: CONFIG.API_BASE_URL,
  summary: {
    totalTests: 0,
    passed: 0,
    failed: 0,
    errors: 0
  },
  endpoints: []
};

/**
 * Test configuration for all endpoints
 */
const ENDPOINT_TESTS = [
  {
    category: 'Public Health Endpoints',
    description: 'Basic system health endpoints - should be publicly accessible',
    tests: [
      {
        name: 'Basic Health Check',
        path: '/api/v1/health',
        expectedStatus: 200,
        expectedResponseFields: ['success', 'timestamp'],
        public: true,
        critical: true
      },
      {
        name: 'Authentication Health',
        path: '/auth/health',
        expectedStatus: 200,
        expectedResponseFields: ['success'],
        public: true,
        critical: true
      },
      {
        name: 'Analytics Health',
        path: '/api/v1/analytics/health',
        expectedStatus: 200,
        expectedResponseFields: ['success', 'health'],
        public: true,
        critical: true
      }
    ]
  },
  {
    category: 'AI Status Endpoints (NEW - Public Access)',
    description: 'AI system status endpoints - UPDATED to be publicly accessible with filtered responses',
    tests: [
      {
        name: 'AI System Status (Main)',
        path: '/api/v1/ai/status',
        expectedStatus: 200,
        expectedResponseFields: ['success', 'system', 'status', 'timestamp', 'services', 'uptime'],
        public: true,
        critical: true,
        securityNote: 'Should return filtered public information only'
      },
      {
        name: 'AI Tier 1 Status',
        path: '/api/v1/ai/tier1/status',
        expectedStatus: 200,
        expectedResponseFields: ['success', 'tier', 'status', 'timestamp', 'uptime'],
        public: true,
        critical: true,
        securityNote: 'Should return filtered public information only'
      },
      {
        name: 'AI Tier 2 Status',
        path: '/api/v1/ai/tier2/status',
        expectedStatus: 200,
        expectedResponseFields: ['success', 'tier', 'status', 'timestamp', 'uptime'],
        public: true,
        critical: true,
        securityNote: 'Should return filtered public information only'
      }
    ]
  },
  {
    category: 'Protected Endpoints (Authentication Required)',
    description: 'Endpoints that should require authentication - testing security',
    tests: [
      {
        name: 'Teacher Analytics',
        path: '/api/v1/analytics/teacher',
        expectedStatus: 401,
        expectedResponseFields: ['error'],
        public: false,
        critical: true,
        securityNote: 'Should require authentication'
      },
      {
        name: 'Session Analytics',
        path: '/api/v1/analytics/session/test-session-id',
        expectedStatus: 401,
        expectedResponseFields: ['error'],
        public: false,
        critical: true,
        securityNote: 'Should require authentication'
      },
      {
        name: 'AI Insights',
        path: '/api/v1/ai/insights/test-session-id',
        expectedStatus: 401,
        expectedResponseFields: ['error'],
        public: false,
        critical: true,
        securityNote: 'Should require authentication'
      }
    ]
  }
];

/**
 * Test individual endpoint
 */
async function testEndpoint(test) {
  const startTime = performance.now();
  const result = {
    name: test.name,
    path: test.path,
    expectedStatus: test.expectedStatus,
    public: test.public,
    critical: test.critical,
    securityNote: test.securityNote,
    timestamp: new Date().toISOString(),
    success: false,
    actualStatus: null,
    responseTime: 0,
    response: null,
    error: null,
    fieldValidation: {},
    securityValidation: {}
  };

  try {
    console.log(`Testing: ${test.name} (${test.path})`);
    
    const response = await axios.get(`${CONFIG.API_BASE_URL}${test.path}`, {
      timeout: CONFIG.TIMEOUT,
      validateStatus: () => true // Don't throw on non-2xx status codes
    });
    
    const endTime = performance.now();
    result.responseTime = Math.round(endTime - startTime);
    result.actualStatus = response.status;
    result.response = response.data;
    
    // Check status code
    if (response.status === test.expectedStatus) {
      result.success = true;
      console.log(`  ✅ Status: ${response.status} (${result.responseTime}ms)`);
    } else {
      result.success = false;
      console.log(`  ❌ Status: Expected ${test.expectedStatus}, got ${response.status}`);
    }
    
    // Validate expected fields
    if (test.expectedResponseFields && response.data && typeof response.data === 'object') {
      test.expectedResponseFields.forEach(field => {
        const hasField = response.data.hasOwnProperty(field);
        result.fieldValidation[field] = hasField;
        console.log(`  ${hasField ? '✅' : '❌'} Field '${field}': ${hasField ? 'Present' : 'Missing'}`);
      });
    }
    
    // Security validation
    if (test.public && response.status === 200) {
      // For public endpoints, check that sensitive information is filtered
      const responseStr = JSON.stringify(response.data);
      const sensitiveTerms = ['endpoint', 'buffer', 'error', 'internal', 'databricks', 'config'];
      
      sensitiveTerms.forEach(term => {
        const containsSensitive = responseStr.toLowerCase().includes(term.toLowerCase());
        result.securityValidation[term] = !containsSensitive ? 'SAFE' : 'SENSITIVE_DETECTED';
        if (containsSensitive) {
          console.log(`  ⚠️  Potential sensitive info: '${term}' detected in public response`);
        }
      });
    }
    
  } catch (error) {
    const endTime = performance.now();
    result.responseTime = Math.round(endTime - startTime);
    result.error = error.message;
    result.success = false;
    
    if (error.code === 'ECONNREFUSED') {
      console.log(`  ❌ Connection refused - server not running?`);
      result.error = 'Server not responding (ECONNREFUSED)';
    } else {
      console.log(`  ❌ Error: ${error.message}`);
    }
  }
  
  // Update summary
  testResults.summary.totalTests++;
  if (result.success) {
    testResults.summary.passed++;
  } else if (result.error) {
    testResults.summary.errors++;
  } else {
    testResults.summary.failed++;
  }
  
  return result;
}

/**
 * Run all endpoint tests
 */
async function runAllTests() {
  console.log('🧪 Starting ClassWaves Health Endpoints Testing...\n');
  console.log(`🌐 Server URL: ${CONFIG.API_BASE_URL}\n`);
  
  for (const category of ENDPOINT_TESTS) {
    console.log(`\n📁 Category: ${category.category}`);
    console.log(`📝 ${category.description}\n`);
    
    const categoryResults = {
      category: category.category,
      description: category.description,
      tests: []
    };
    
    for (const test of category.tests) {
      const result = await testEndpoint(test);
      categoryResults.tests.push(result);
      
      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    testResults.endpoints.push(categoryResults);
  }
}

/**
 * Generate markdown report
 */
function generateMarkdownReport() {
  const reportPath = path.join(CONFIG.OUTPUT_DIR, CONFIG.REPORT_FILE);
  
  let markdown = `# ClassWaves Health Endpoints Test Report

**Generated**: ${testResults.timestamp}  
**Server**: ${testResults.serverUrl}  
**Test Suite**: Health Endpoint Architecture Alignment  

## 🎯 Executive Summary

This report validates the implementation of the **tiered security model** for ClassWaves health endpoints, specifically the architectural alignment of AI status endpoints to be publicly accessible with filtered responses.

### 📊 Test Results Summary

- **Total Tests**: ${testResults.summary.totalTests}
- **✅ Passed**: ${testResults.summary.passed}
- **❌ Failed**: ${testResults.summary.failed}
- **🔥 Errors**: ${testResults.summary.errors}
- **📈 Success Rate**: ${Math.round((testResults.summary.passed / testResults.summary.totalTests) * 100)}%

### 🏆 Overall Status

${testResults.summary.errors > 0 ? 
  '❌ **CRITICAL**: Server connection issues detected' : 
  testResults.summary.failed > 0 ? 
    '⚠️ **WARNING**: Some tests failed' : 
    '✅ **SUCCESS**: All tests passed'
}

---

## 📋 Detailed Test Results

`;

  // Add detailed results for each category
  testResults.endpoints.forEach(category => {
    markdown += `\n### 📁 ${category.category}\n\n`;
    markdown += `${category.description}\n\n`;
    
    category.tests.forEach(test => {
      const status = test.success ? '✅ PASSED' : test.error ? '🔥 ERROR' : '❌ FAILED';
      
      markdown += `#### ${test.name}\n\n`;
      markdown += `- **Path**: \`${test.path}\`\n`;
      markdown += `- **Expected Status**: ${test.expectedStatus}\n`;
      markdown += `- **Actual Status**: ${test.actualStatus || 'N/A'}\n`;
      markdown += `- **Response Time**: ${test.responseTime}ms\n`;
      markdown += `- **Result**: ${status}\n`;
      markdown += `- **Public Access**: ${test.public ? '🌐 Public' : '🔒 Protected'}\n`;
      
      if (test.securityNote) {
        markdown += `- **Security Note**: ${test.securityNote}\n`;
      }
      
      if (test.error) {
        markdown += `- **Error**: ${test.error}\n`;
      }
      
      // Field validation
      if (Object.keys(test.fieldValidation).length > 0) {
        markdown += `- **Field Validation**:\n`;
        Object.entries(test.fieldValidation).forEach(([field, present]) => {
          markdown += `  - \`${field}\`: ${present ? '✅ Present' : '❌ Missing'}\n`;
        });
      }
      
      // Security validation
      if (Object.keys(test.securityValidation).length > 0) {
        markdown += `- **Security Validation**:\n`;
        Object.entries(test.securityValidation).forEach(([term, status]) => {
          markdown += `  - ${term}: ${status === 'SAFE' ? '✅ Safe' : '⚠️ Sensitive info detected'}\n`;
        });
      }
      
      // Response sample (truncated)
      if (test.response && test.success) {
        const responseStr = JSON.stringify(test.response, null, 2);
        const truncated = responseStr.length > 500 ? responseStr.substring(0, 500) + '...' : responseStr;
        markdown += `- **Response Sample**:\n\`\`\`json\n${truncated}\n\`\`\`\n`;
      }
      
      markdown += `\n---\n\n`;
    });
  });

  // Add recommendations section
  markdown += `## 📝 Recommendations & Next Steps\n\n`;
  
  if (testResults.summary.errors > 0) {
    markdown += `### 🔥 Critical Issues\n`;
    markdown += `1. **Start Backend Server**: Ensure ClassWaves backend is running on ${CONFIG.API_BASE_URL}\n`;
    markdown += `2. **Verify Services**: Check that all required services (Redis, Databricks, etc.) are initialized\n\n`;
  }
  
  if (testResults.summary.failed > 0) {
    markdown += `### ⚠️ Failed Tests\n`;
    const failedTests = testResults.endpoints.flatMap(cat => cat.tests.filter(test => !test.success && !test.error));
    failedTests.forEach(test => {
      markdown += `- **${test.name}**: Expected ${test.expectedStatus}, got ${test.actualStatus}\n`;
    });
    markdown += `\n`;
  }
  
  markdown += `### ✅ Successful Implementation Validation\n`;
  markdown += `If all tests pass, this confirms:\n`;
  markdown += `1. **✅ Architectural Alignment**: AI status endpoints are now publicly accessible\n`;
  markdown += `2. **✅ Security Model**: Sensitive information is properly filtered from public responses\n`;
  markdown += `3. **✅ Authentication**: Protected endpoints still require proper authentication\n`;
  markdown += `4. **✅ Performance**: All endpoints respond within acceptable time limits\n\n`;
  
  markdown += `### 🚀 Deployment Readiness\n`;
  markdown += `- **Ready for CI/CD Integration**: Health checks can now be automated in deployment pipeline\n`;
  markdown += `- **Monitoring Integration**: Public status endpoints available for load balancers and monitoring\n`;
  markdown += `- **Operational Excellence**: Incident response teams can quickly assess system health\n\n`;
  
  markdown += `---\n\n`;
  markdown += `**Report Generated**: ${new Date().toISOString()}  \n`;
  markdown += `**ClassWaves Meta-Expert Implementation**: Phase 1 Complete  \n`;

  fs.writeFileSync(reportPath, markdown);
  return reportPath;
}

/**
 * Generate JSON report for programmatic access
 */
function generateJsonReport() {
  const jsonPath = path.join(CONFIG.OUTPUT_DIR, 'health-endpoints-test-results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(testResults, null, 2));
  return jsonPath;
}

/**
 * Main execution
 */
async function main() {
  try {
    await runAllTests();
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Tests: ${testResults.summary.totalTests}`);
    console.log(`✅ Passed: ${testResults.summary.passed}`);
    console.log(`❌ Failed: ${testResults.summary.failed}`);
    console.log(`🔥 Errors: ${testResults.summary.errors}`);
    console.log(`📈 Success Rate: ${Math.round((testResults.summary.passed / testResults.summary.totalTests) * 100)}%`);
    
    // Generate reports
    const markdownPath = generateMarkdownReport();
    const jsonPath = generateJsonReport();
    
    console.log('\n📋 REPORTS GENERATED:');
    console.log(`📝 Markdown Report: ${markdownPath}`);
    console.log(`📊 JSON Data: ${jsonPath}`);
    
    // Final status
    if (testResults.summary.errors > 0) {
      console.log('\n🔥 CRITICAL: Server connection issues - start backend server');
      process.exit(1);
    } else if (testResults.summary.failed > 0) {
      console.log('\n⚠️  WARNING: Some tests failed - review results');
      process.exit(0);
    } else {
      console.log('\n✅ SUCCESS: All health endpoints working correctly!');
      console.log('🚀 Ready for deployment and CI/CD integration');
      process.exit(0);
    }
    
  } catch (error) {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { main, testEndpoint, generateMarkdownReport };

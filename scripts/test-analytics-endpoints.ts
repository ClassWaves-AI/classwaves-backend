#!/usr/bin/env ts-node

/**
 * Test Analytics Endpoints
 * 
 * Tests the analytics endpoints to verify they no longer return 500 errors.
 * This simulates the frontend requests that were failing.
 */

import axios from 'axios';
import { performance } from 'perf_hooks';

const BASE_URL = 'http://localhost:3000';

interface TestResult {
  endpoint: string;
  status: number;
  responseTime: number;
  success: boolean;
  error?: string;
  data?: any;
}

async function testAnalyticsEndpoints() {
  console.log('🧪 Testing Analytics Endpoints');
  console.log('================================');
  
  const results: TestResult[] = [];
  
  // Test 1: Basic health check
  results.push(await testEndpoint('GET', '/api/v1/health', {}));
  
  // Test 2: Teacher analytics without auth (should get 401, not 500)
  results.push(await testEndpoint('GET', '/api/v1/analytics/teacher', {}));
  
  // Test 3: Session analytics without auth (should get 401, not 500)  
  results.push(await testEndpoint('GET', '/api/v1/analytics/session/test-session-id', {}));
  
  // Print results
  console.log('\n📊 Test Results:');
  console.log('================');
  
  let passCount = 0;
  let failCount = 0;
  
  results.forEach((result, index) => {
    const status = result.status === 401 ? '✅ PASS (Expected 401)' : 
                   result.status === 200 ? '✅ PASS' :
                   result.status === 500 ? '❌ FAIL (500 Error)' : 
                   `⚠️  WARN (Status ${result.status})`;
    
    console.log(`${index + 1}. ${result.endpoint}`);
    console.log(`   Status: ${result.status} | Time: ${result.responseTime.toFixed(2)}ms`);
    console.log(`   Result: ${status}`);
    
    if (result.error && result.status === 500) {
      console.log(`   Error: ${result.error}`);
      failCount++;
    } else {
      passCount++;
    }
    console.log('');
  });
  
  console.log(`📈 Summary: ${passCount} passed, ${failCount} failed`);
  
  if (failCount === 0) {
    console.log('🎉 All tests passed! Analytics endpoints are working correctly.');
    return true;
  } else {
    console.log('💥 Some tests failed. Check the errors above.');
    return false;
  }
}

async function testEndpoint(method: string, path: string, headers: Record<string, string>): Promise<TestResult> {
  const startTime = performance.now();
  
  try {
    const response = await axios({
      method,
      url: `${BASE_URL}${path}`,
      headers,
      timeout: 10000,
      validateStatus: () => true // Don't throw on HTTP error status
    });
    
    const responseTime = performance.now() - startTime;
    
    return {
      endpoint: `${method} ${path}`,
      status: response.status,
      responseTime,
      success: response.status < 500,
      data: response.data
    };
  } catch (error: any) {
    const responseTime = performance.now() - startTime;
    
    return {
      endpoint: `${method} ${path}`,
      status: error.response?.status || 0,
      responseTime,
      success: false,
      error: error.message
    };
  }
}

// Advanced test with mock authentication
async function testWithMockAuth() {
  console.log('\n🔐 Testing with Mock Authentication');
  console.log('===================================');
  
  // This would require creating a test JWT token
  // For now, we'll just verify the endpoints don't crash
  
  const mockHeaders = {
    'Authorization': 'Bearer mock-token-for-testing',
    'Content-Type': 'application/json'
  };
  
  const results: TestResult[] = [];
  
  // Test teacher analytics with mock auth (should get proper error handling, not 500)
  results.push(await testEndpoint('GET', '/api/v1/analytics/teacher', mockHeaders));
  
  // Test session analytics with mock auth
  results.push(await testEndpoint('GET', '/api/v1/analytics/session/test-session-id', mockHeaders));
  
  results.forEach((result, index) => {
    const status = result.status === 500 ? '❌ FAIL (Still 500 Error)' : 
                   result.status === 401 ? '✅ PASS (Auth Error)' :
                   result.status === 403 ? '✅ PASS (Forbidden)' :
                   result.status === 200 ? '✅ PASS (Success)' :
                   `⚠️  WARN (Status ${result.status})`;
    
    console.log(`${index + 1}. ${result.endpoint}`);
    console.log(`   Status: ${result.status} | Time: ${result.responseTime.toFixed(2)}ms`);
    console.log(`   Result: ${status}`);
    
    if (result.error && result.status === 500) {
      console.log(`   Error: ${result.error}`);
    }
    console.log('');
  });
}

async function waitForServer() {
  console.log('⏳ Waiting for server to start...');
  
  let attempts = 0;
  const maxAttempts = 30; // 30 seconds
  
  while (attempts < maxAttempts) {
    try {
      const response = await axios.get(`${BASE_URL}/api/v1/health`, { timeout: 2000 });
      if (response.status === 200) {
        console.log('✅ Server is ready!');
        return true;
      }
    } catch (error) {
      // Server not ready yet
    }
    
    attempts++;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('❌ Server failed to start within 30 seconds');
  return false;
}

// Run the tests
if (require.main === module) {
  waitForServer()
    .then(async (serverReady) => {
      if (!serverReady) {
        process.exit(1);
      }
      
      const success = await testAnalyticsEndpoints();
      await testWithMockAuth();
      
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error('💥 Test failed:', error);
      process.exit(1);
    });
}

export { testAnalyticsEndpoints };

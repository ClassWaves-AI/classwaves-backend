#!/usr/bin/env ts-node
import { logger } from '../utils/logger';

// No direct service imports needed - we use the running API endpoints instead

interface EndpointTest {
  method: string;
  path: string;
  description: string;
  requiredAuth: boolean;
  testData?: any;
  expectedStatus: number;
  expectedResponse?: any;
}

interface TestResult {
  endpoint: string;
  method: string;
  status: 'passed' | 'failed' | 'skipped';
  responseTime: number;
  statusCode: number;
  error?: string;
  details?: any;
}

interface AuditReport {
  timestamp: string;
  overallStatus: 'healthy' | 'degraded' | 'unhealthy';
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    successRate: number;
  };
  results: TestResult[];
  recommendations: string[];
  systemHealth: any;
}

class APIHealthAuditor {
  private baseUrl: string;
  private authToken: string | null = null;

  constructor(baseUrl: string = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
  }

  private async getValidAuthToken(): Promise<string | null> {
    try {
      // Try to get token from environment variable first
      if (process.env.API_AUDIT_TOKEN) {
        logger.debug('🔑 Using API_AUDIT_TOKEN from environment');
        return process.env.API_AUDIT_TOKEN;
      }

      // Try to get token from running system (if available)
      logger.debug('🔑 Attempting to get valid auth token from running system...');
      
      // Check if we can create a test user session
      const testAuthResponse = await fetch(`${this.baseUrl}/api/v1/auth/test-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@classwaves.ai',
          role: 'teacher'
        })
      });

      if (testAuthResponse.ok) {
        const authData = await testAuthResponse.json() as any;
        if (authData?.token) {
          logger.debug('✅ Got valid test token from system');
          return authData.token;
        }
      }

      // Fallback: try to use existing session if available
      logger.debug('⚠️  No valid token available. Some endpoints will be skipped.');
      return null;

    } catch (error) {
      logger.debug('⚠️  Could not get auth token:', error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  private async makeRequest(test: EndpointTest): Promise<TestResult> {
    const startTime = Date.now();
    const url = `${this.baseUrl}${test.path}`;
    
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      if (test.requiredAuth && this.authToken) {
        headers['Authorization'] = `Bearer ${this.authToken}`;
      }

      const options: RequestInit = {
        method: test.method,
        headers
      };

      if (test.testData && ['POST', 'PUT', 'PATCH'].includes(test.method)) {
        options.body = JSON.stringify(test.testData);
      }

      const response = await fetch(url, options);
      const responseTime = Date.now() - startTime;
      
      let responseBody;
      try {
        responseBody = await response.text();
        if (responseBody) {
          responseBody = JSON.parse(responseBody);
        }
      } catch {
        // Response might not be JSON
      }

      const result: TestResult = {
        endpoint: test.path,
        method: test.method,
        status: response.status === test.expectedStatus ? 'passed' : 'failed',
        responseTime,
        statusCode: response.status,
        details: {
          expectedStatus: test.expectedStatus,
          responseBody,
          headers: Object.fromEntries(response.headers.entries())
        }
      };

      if (result.status === 'failed') {
        result.error = `Expected status ${test.expectedStatus}, got ${response.status}`;
      }

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      return {
        endpoint: test.path,
        method: test.method,
        status: 'failed',
        responseTime: Date.now() - startTime,
        statusCode: 0,
        error: errorMessage,
        details: { error: errorStack }
      };
    }
  }

  private getEndpointsToTest(): EndpointTest[] {
    return [
      // Health endpoints
      {
        method: 'GET',
        path: '/api/v1/health',
        description: 'Basic health check',
        requiredAuth: false,
        expectedStatus: 200
      },
      {
        method: 'GET',
        path: '/api/v1/health/detailed',
        description: 'Detailed health check',
        requiredAuth: false,
        expectedStatus: 200
      },
      {
        method: 'GET',
        path: '/api/v1/health/errors',
        description: 'Error summary',
        requiredAuth: false,
        expectedStatus: 200
      },

      // Analytics endpoints
      {
        method: 'GET',
        path: '/api/v1/analytics/teacher',
        description: 'Teacher analytics',
        requiredAuth: true,
        expectedStatus: 200
      },
      {
        method: 'GET',
        path: '/api/v1/analytics/session/test-session-id',
        description: 'Session analytics',
        requiredAuth: true,
        expectedStatus: 200
      },
      {
        method: 'GET',
        path: '/api/v1/analytics/session/test-session-id/membership-summary',
        description: 'Session membership summary',
        requiredAuth: true,
        expectedStatus: 200
      },
      {
        method: 'GET',
        path: '/api/v1/analytics/session/test-session-id/overview',
        description: 'Session overview',
        requiredAuth: true,
        expectedStatus: 200
      },

      // Session management endpoints
      {
        method: 'GET',
        path: '/api/v1/sessions',
        description: 'List sessions',
        requiredAuth: true,
        expectedStatus: 200
      },
      {
        method: 'GET',
        path: '/api/v1/sessions/test-session-id',
        description: 'Get session details',
        requiredAuth: true,
        expectedStatus: 200
      },

      // Group management endpoints
      {
        method: 'GET',
        path: '/api/v1/sessions/test-session-id/groups',
        description: 'List session groups',
        requiredAuth: true,
        expectedStatus: 200
      },

      // AI Analysis endpoints
      {
        method: 'GET',
        path: '/api/v1/ai-analysis/session/test-session-id/insights',
        description: 'AI insights for session',
        requiredAuth: true,
        expectedStatus: 200
      },

      // Teacher guidance endpoints
      {
        method: 'GET',
        path: '/api/v1/guidance/session/test-session-id/suggestions',
        description: 'Teacher guidance suggestions',
        requiredAuth: true,
        expectedStatus: 200
      }
    ];
  }

  private async checkSystemHealth(): Promise<any> {
    try {
      // Check Redis via the running service
      let redisHealth = 'unknown';
      try {
        const redisResponse = await fetch(`${this.baseUrl}/api/v1/health/detailed`);
        if (redisResponse.ok) {
          const healthData = await redisResponse.json() as any;
          redisHealth = healthData.redis?.status || 'unknown';
        }
      } catch (error) {
        redisHealth = 'error';
      }
      
      // Check system health via the health endpoint instead of direct service calls
      let systemHealth: any = 'unknown';
      try {
        const healthResponse = await fetch(`${this.baseUrl}/api/v1/health/detailed`);
        if (healthResponse.ok) {
          const healthData = await healthResponse.json() as any;
          systemHealth = healthData;
        }
      } catch (error) {
        systemHealth = 'error';
      }

      return {
        redis: { status: redisHealth, details: { method: 'via_health_endpoint' } },
        systemHealth: systemHealth,
        method: 'via_api_endpoints'
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      return {
        error: errorMessage,
        stack: errorStack
      };
    }
  }

  async runAudit(): Promise<AuditReport> {
    logger.debug('🔍 Starting comprehensive API health audit...\n');

    // Get valid auth token first
    this.authToken = await this.getValidAuthToken();

    const endpoints = this.getEndpointsToTest();
    const results: TestResult[] = [];
    
    // Check system health first
    logger.debug('🏥 Checking system health...');
    const systemHealth = await this.checkSystemHealth();
    
    // Test each endpoint
    logger.debug(`\n🧪 Testing ${endpoints.length} endpoints...\n`);
    
    for (const endpoint of endpoints) {
      logger.debug(`Testing ${endpoint.method} ${endpoint.path}...`);
      
      if (endpoint.requiredAuth && !this.authToken) {
        const result: TestResult = {
          endpoint: endpoint.path,
          method: endpoint.method,
          status: 'skipped',
          responseTime: 0,
          statusCode: 0,
          details: { reason: 'No auth token available' }
        };
        results.push(result);
        logger.debug(`  ⏭️  Skipped (no auth)`);
        continue;
      }

      const result = await this.makeRequest(endpoint);
      results.push(result);
      
      const statusIcon = result.status === 'passed' ? '✅' : result.status === 'failed' ? '❌' : '⏭️';
      logger.debug(`  ${statusIcon} ${result.status} (${result.responseTime}ms)`);
      
      if (result.status === 'failed') {
        logger.debug(`    Error: ${result.error}`);
      }
    }

    // Calculate summary
    const total = results.length;
    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const successRate = total > 0 ? (passed / (total - skipped)) * 100 : 0;

    // Determine overall status
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
    if (failed === 0 && successRate >= 95) {
      overallStatus = 'healthy';
    } else if (failed <= 2 && successRate >= 80) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'unhealthy';
    }

    // Generate recommendations
    const recommendations: string[] = [];
    
    if (failed > 0) {
      recommendations.push(`Fix ${failed} failing endpoint(s)`);
    }
    
    if (successRate < 95) {
      recommendations.push('Improve endpoint reliability');
    }
    
    if (systemHealth.error) {
      recommendations.push('Resolve system health issues');
    }

    const report: AuditReport = {
      timestamp: new Date().toISOString(),
      overallStatus,
      summary: {
        total,
        passed,
        failed,
        skipped,
        successRate: Math.round(successRate * 100) / 100
      },
      results,
      recommendations,
      systemHealth
    };

    logger.debug('\n📊 Audit Results:');
    logger.debug(`Overall Status: ${overallStatus.toUpperCase()}`);
    logger.debug(`Success Rate: ${successRate.toFixed(1)}%`);
    logger.debug(`Passed: ${passed}, Failed: ${failed}, Skipped: ${skipped}`);
    
    if (recommendations.length > 0) {
      logger.debug('\n💡 Recommendations:');
      recommendations.forEach(rec => logger.debug(`  • ${rec}`));
    }

    return report;
  }

  async generateDetailedReport(): Promise<string> {
    const report = await this.runAudit();
    
    let reportText = `# API Health Audit Report\n\n`;
    reportText += `**Generated:** ${report.timestamp}\n`;
    reportText += `**Overall Status:** ${report.overallStatus.toUpperCase()}\n`;
    reportText += `**Success Rate:** ${report.summary.successRate}%\n\n`;
    
    reportText += `## Summary\n\n`;
    reportText += `- Total Endpoints: ${report.summary.total}\n`;
    reportText += `- Passed: ${report.summary.passed}\n`;
    reportText += `- Failed: ${report.summary.failed}\n`;
    reportText += `- Skipped: ${report.summary.skipped}\n\n`;
    
    reportText += `## Detailed Results\n\n`;
    report.results.forEach(result => {
      const statusIcon = result.status === 'passed' ? '✅' : result.status === 'failed' ? '❌' : '⏭️';
      reportText += `### ${result.method} ${result.endpoint}\n`;
      reportText += `- Status: ${statusIcon} ${result.status}\n`;
      reportText += `- Response Time: ${result.responseTime}ms\n`;
      reportText += `- Status Code: ${result.statusCode}\n`;
      
      if (result.error) {
        reportText += `- Error: ${result.error}\n`;
      }
      
      if (result.details) {
        reportText += `- Details: ${JSON.stringify(result.details, null, 2)}\n`;
      }
      
      reportText += '\n';
    });
    
    if (report.recommendations.length > 0) {
      reportText += `## Recommendations\n\n`;
      report.recommendations.forEach(rec => {
        reportText += `- ${rec}\n`;
      });
      reportText += '\n';
    }
    
    reportText += `## System Health\n\n`;
    reportText += `\`\`\`json\n${JSON.stringify(report.systemHealth, null, 2)}\n\`\`\`\n`;
    
    return reportText;
  }
}

// CLI execution
if (require.main === module) {
  const auditor = new APIHealthAuditor();
  
  auditor.runAudit()
    .then(() => {
      logger.debug('\n🎉 Audit completed!');
      process.exit(0);
    })
    .catch(error => {
      logger.error('\n💥 Audit failed:', error);
      process.exit(1);
    });
}

export { APIHealthAuditor };

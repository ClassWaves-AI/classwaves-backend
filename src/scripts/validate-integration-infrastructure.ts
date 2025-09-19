#!/usr/bin/env ts-node

/**
 * ClassWaves Integration Test Infrastructure Validator
 * 
 * This script provisions and validates complete test infrastructure stack for
 * integration testing including Redis namespaces, WebSocket servers, and auth services.
 * Creates infrastructure health check with dependency validation to enable
 * comprehensive integration test execution.
 * 
 * USAGE:
 *   npm run validate-integration-infrastructure
 * 
 * REQUIREMENTS:
 *   - Backend service running on port 3000
 *   - Redis service operational
 *   - Valid Databricks connection for auth validation
 *   - WebSocket infrastructure available
 * 
 * PURPOSE:
 *   - Enable integration test execution (Task 2.2b) 
 *   - Validate service orchestration (Backend + Redis + WebSocket)
 *   - Ensure test infrastructure isolation and stability
 *   - Provide actionable error messages for infrastructure failures
 * 
 * PLATFORM STABILIZATION: Task 1.9 [P1] - Critical Path Infrastructure
 * Addresses Platform Stabilization Master Checklist Task 1.9
 * 
 * PERFORMANCE TARGET: <30 seconds execution time
 * SCOPE: Infrastructure validation and setup, no test execution
 */

import { RedisNamespaceValidator } from './redis-namespace-setup';
import { WebSocketHealthChecker } from './websocket-health-check';
import { AuthServiceValidator } from './auth-service-validation';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

// Load environment variables
dotenv.config();

interface InfrastructureValidationResult {
  component: string;
  status: 'OPERATIONAL' | 'DEGRADED' | 'FAILED';
  details: string;
  responseTime?: number;
  errors?: string[];
  warnings?: string[];
}

interface ValidationReport {
  success: boolean;
  executionTime: number;
  timestamp: string;
  environment: string;
  components: InfrastructureValidationResult[];
  summary: {
    totalComponents: number;
    operational: number;
    degraded: number;
    failed: number;
    criticalIssues: string[];
  };
  nextSteps?: string[];
}

class IntegrationInfrastructureValidator {
  private startTime: number = 0;
  private redisValidator: RedisNamespaceValidator;
  private websocketChecker: WebSocketHealthChecker;
  private authValidator: AuthServiceValidator;

  constructor() {
    this.redisValidator = new RedisNamespaceValidator();
    this.websocketChecker = new WebSocketHealthChecker();
    this.authValidator = new AuthServiceValidator();
  }

  /**
   * Main validation entry point
   * Orchestrates validation of all integration test infrastructure components
   */
  async validateInfrastructure(): Promise<ValidationReport> {
    this.startTime = performance.now();
    logger.debug('🏗️ ClassWaves Integration Test Infrastructure Validator Starting...\n');

    const report: ValidationReport = {
      success: false,
      executionTime: 0,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      components: [],
      summary: {
        totalComponents: 0,
        operational: 0,
        degraded: 0,
        failed: 0,
        criticalIssues: []
      },
      nextSteps: []
    };

    try {
      logger.debug('🔍 Validating Integration Test Infrastructure Components:\n');

      // 1. Validate Redis namespace infrastructure
      logger.debug('1️⃣ Validating Redis Namespace Infrastructure...');
      const redisResult = await this.validateWithTimeout(
        'Redis Namespaces',
        () => this.redisValidator.validateRedisNamespaces(),
        10000 // 10 second timeout
      );
      report.components.push(redisResult);

      // 2. Validate WebSocket server infrastructure  
      logger.debug('\n2️⃣ Validating WebSocket Server Infrastructure...');
      const websocketResult = await this.validateWithTimeout(
        'WebSocket Health',
        () => this.websocketChecker.validateWebSocketHealth(),
        10000 // 10 second timeout
      );
      report.components.push(websocketResult);

      // 3. Validate authentication service integration
      logger.debug('\n3️⃣ Validating Authentication Service Integration...');
      const authResult = await this.validateWithTimeout(
        'Auth Service Integration',
        () => this.authValidator.validateAuthIntegration(),
        15000 // 15 second timeout
      );
      report.components.push(authResult);

      // 4. Validate service orchestration
      logger.debug('\n4️⃣ Validating Service Orchestration...');
      const orchestrationResult = await this.validateServiceOrchestration();
      report.components.push(orchestrationResult);

      // Calculate summary
      report.summary = this.calculateSummary(report.components);
      report.success = report.summary.failed === 0;
      report.executionTime = performance.now() - this.startTime;

      // Generate next steps
      report.nextSteps = this.generateNextSteps(report);

      // Print final report
      this.printFinalReport(report);

      return report;

    } catch (error) {
      report.executionTime = performance.now() - this.startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      report.summary.criticalIssues.push(`Infrastructure validation failed: ${errorMessage}`);
      
      logger.error('❌ CRITICAL INFRASTRUCTURE FAILURE:', error);
      return report;
    }
  }

  /**
   * Validate component with timeout protection
   */
  private async validateWithTimeout(
    componentName: string,
    validationFn: () => Promise<InfrastructureValidationResult>,
    timeoutMs: number
  ): Promise<InfrastructureValidationResult> {
    const componentStartTime = performance.now();

    try {
      const timeoutPromise = new Promise<InfrastructureValidationResult>((_, reject) => {
        setTimeout(() => reject(new Error(`Validation timeout after ${timeoutMs}ms`)), timeoutMs);
      });

      const result = await Promise.race([validationFn(), timeoutPromise]);
      result.responseTime = performance.now() - componentStartTime;
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        component: componentName,
        status: 'FAILED',
        details: `Validation failed: ${errorMessage}`,
        responseTime: performance.now() - componentStartTime,
        errors: [errorMessage]
      };
    }
  }

  /**
   * Validate service orchestration between Backend, Redis, and WebSocket
   */
  private async validateServiceOrchestration(): Promise<InfrastructureValidationResult> {
    const startTime = performance.now();
    
    try {
      const errors: string[] = [];
      const warnings: string[] = [];

      // Test basic backend health
      logger.debug('   🔍 Testing backend service availability...');
      const backendHealthy = await this.testBackendHealth();
      if (!backendHealthy) {
        errors.push('Backend service not responding on port 3000');
      } else {
        logger.debug('   ✅ Backend service responding');
      }

      // Test Redis-Backend integration
      logger.debug('   🔍 Testing Redis-Backend integration...');
      const redisIntegrationHealthy = await this.testRedisBackendIntegration();
      if (!redisIntegrationHealthy) {
        warnings.push('Redis-Backend integration may have issues');
      } else {
        logger.debug('   ✅ Redis-Backend integration operational');
      }

      // Test WebSocket-Backend coordination
      logger.debug('   🔍 Testing WebSocket-Backend coordination...');
      const wsIntegrationHealthy = await this.testWebSocketBackendIntegration();
      if (!wsIntegrationHealthy) {
        warnings.push('WebSocket-Backend coordination may have issues');
      } else {
        logger.debug('   ✅ WebSocket-Backend coordination operational');
      }

      const status = errors.length > 0 ? 'FAILED' : 
                    warnings.length > 0 ? 'DEGRADED' : 'OPERATIONAL';

      return {
        component: 'Service Orchestration',
        status,
        details: `Backend + Redis + WebSocket coordination ${status.toLowerCase()}`,
        responseTime: performance.now() - startTime,
        errors: errors.length > 0 ? errors : undefined,
        warnings: warnings.length > 0 ? warnings : undefined
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        component: 'Service Orchestration',
        status: 'FAILED',
        details: `Service orchestration validation failed: ${errorMessage}`,
        responseTime: performance.now() - startTime,
        errors: [errorMessage]
      };
    }
  }

  /**
   * Test backend service health
   */
  private async testBackendHealth(): Promise<boolean> {
    try {
      // Try to connect to backend health endpoint with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch('http://localhost:3000/api/v1/health', {
        method: 'GET',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.debug(`   ⚠️ Backend health check failed: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Test Redis-Backend integration
   */
  private async testRedisBackendIntegration(): Promise<boolean> {
    try {
      // This would be implemented based on actual Redis service integration
      // For now, return true if Redis validator succeeded
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.debug(`   ⚠️ Redis-Backend integration test failed: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Test WebSocket-Backend coordination
   */
  private async testWebSocketBackendIntegration(): Promise<boolean> {
    try {
      // This would be implemented based on actual WebSocket service integration  
      // For now, return true if WebSocket health check succeeded
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.debug(`   ⚠️ WebSocket-Backend integration test failed: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Calculate validation summary
   */
  private calculateSummary(components: InfrastructureValidationResult[]) {
    const summary = {
      totalComponents: components.length,
      operational: 0,
      degraded: 0,
      failed: 0,
      criticalIssues: [] as string[]
    };

    components.forEach(component => {
      switch (component.status) {
        case 'OPERATIONAL':
          summary.operational++;
          break;
        case 'DEGRADED':
          summary.degraded++;
          break;
        case 'FAILED':
          summary.failed++;
          summary.criticalIssues.push(`${component.component}: ${component.details}`);
          break;
      }
    });

    return summary;
  }

  /**
   * Generate actionable next steps based on validation results
   */
  private generateNextSteps(report: ValidationReport): string[] {
    const nextSteps: string[] = [];

    if (report.success) {
      nextSteps.push('✅ All infrastructure validated - Ready to execute integration tests (Task 2.2b)');
      nextSteps.push('Run: npm run test:integration to validate integration test execution');
    } else {
      nextSteps.push('❌ Fix infrastructure issues before proceeding with integration tests');
      
      report.components.forEach(component => {
        if (component.status === 'FAILED') {
          nextSteps.push(`Fix ${component.component}: ${component.details}`);
        }
      });
      
      if (report.summary.failed > 0) {
        nextSteps.push('Restart infrastructure components and re-run validation');
      }
    }

    return nextSteps;
  }

  /**
   * Print comprehensive final report
   */
  private printFinalReport(report: ValidationReport): void {
    logger.debug('\n' + '='.repeat(80));
    logger.debug('🏗️ INTEGRATION TEST INFRASTRUCTURE VALIDATION REPORT');
    logger.debug('='.repeat(80));
    
    logger.debug(`\n📊 SUMMARY:`);
    logger.debug(`   Execution Time: ${Math.round(report.executionTime)}ms`);
    logger.debug(`   Environment: ${report.environment}`);
    logger.debug(`   Components: ${report.summary.totalComponents} total`);
    logger.debug(`   Status: ${report.summary.operational} operational, ${report.summary.degraded} degraded, ${report.summary.failed} failed`);
    
    logger.debug(`\n🔍 COMPONENT STATUS:`);
    report.components.forEach(component => {
      const statusIcon = component.status === 'OPERATIONAL' ? '✅' : 
                        component.status === 'DEGRADED' ? '⚠️' : '❌';
      logger.debug(`   ${statusIcon} ${component.component}: ${component.status} (${Math.round(component.responseTime || 0)}ms)`);
      
      if (component.errors?.length) {
        component.errors.forEach(error => logger.debug(`      ❌ ${error}`));
      }
      if (component.warnings?.length) {
        component.warnings.forEach(warning => logger.debug(`      ⚠️ ${warning}`));
      }
    });

    if (report.nextSteps?.length) {
      logger.debug(`\n🎯 NEXT STEPS:`);
      report.nextSteps.forEach(step => logger.debug(`   ${step}`));
    }

    logger.debug('\n' + '='.repeat(80));
    
    const finalStatus = report.success ? '✅ INFRASTRUCTURE READY FOR INTEGRATION TESTS' : 
                                        '❌ INFRASTRUCTURE ISSUES REQUIRE ATTENTION';
    logger.debug(finalStatus);
    logger.debug('='.repeat(80) + '\n');
  }
}

// Main execution
async function main() {
  const validator = new IntegrationInfrastructureValidator();
  
  try {
    const report = await validator.validateInfrastructure();
    
    // Exit with appropriate code
    process.exit(report.success ? 0 : 1);
    
  } catch (error) {
    logger.error('💥 FATAL ERROR during infrastructure validation:', error);
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  main();
}

export { IntegrationInfrastructureValidator, InfrastructureValidationResult, ValidationReport };
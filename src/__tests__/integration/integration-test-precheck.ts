#!/usr/bin/env ts-node

/**
 * Integration Test Pre-Check Script
 * 
 * Demonstrates how database schema validation enables integration testing
 * by validating required schemas before running integration tests.
 * 
 * PLATFORM STABILIZATION: Task 1.8 Integration Test Enablement Proof
 */

import { DatabaseSchemaValidator } from '../../scripts/database-schema-validator';

/**
 * Validates database schema before running integration tests
 * Returns: true if integration tests can proceed, false otherwise
 */
export async function validateIntegrationTestPrerequisites(): Promise<boolean> {
  console.log('🔍 Integration Test Prerequisites Check...');
  console.log('====================================================');
  
  const validator = new DatabaseSchemaValidator();
  
  try {
    const report = await validator.validateSchema();
    
    if (report.success) {
      console.log('✅ INTEGRATION TESTS ENABLED');
      console.log(`   - ${report.summary.validSchemas}/${report.summary.totalSchemas} schemas validated`);
      console.log(`   - ${report.summary.validTables}/${report.summary.totalTables} tables verified`);
      console.log(`   - Schema validation completed in ${report.executionTime}ms`);
      console.log('');
      console.log('🚀 Integration tests can proceed safely');
      return true;
    } else {
      console.log('❌ INTEGRATION TESTS BLOCKED');
      console.log(`   - ${report.summary.criticalIssues} critical schema issues found`);
      console.log('');
      console.log('🚨 Critical Errors:');
      report.criticalErrors.forEach((error, i) => {
        console.log(`   ${i + 1}. ${error}`);
      });
      console.log('');
      console.log('🔧 Required Actions:');
      console.log('   1. Fix schema issues listed above');
      console.log('   2. Run: npm run validate-test-schema');
      console.log('   3. Ensure validation passes before running integration tests');
      console.log('');
      console.log('⚠️  Integration tests will FAIL without proper schema setup');
      return false;
    }
  } catch (error) {
    console.log('❌ INTEGRATION TESTS BLOCKED');
    console.log(`   - Schema validation failed: ${error instanceof Error ? error.message : error}`);
    console.log('');
    console.log('🔧 Troubleshooting:');
    console.log('   1. Check DATABRICKS_TOKEN in .env file');
    console.log('   2. Verify Databricks connectivity');
    console.log('   3. Run: npm run validate-test-schema for detailed diagnostics');
    return false;
  }
}

/**
 * Integration Test Schema Validation Guard
 * Call this before running integration test suites
 */
export async function guardIntegrationTestExecution(): Promise<void> {
  const canProceed = await validateIntegrationTestPrerequisites();
  
  if (!canProceed) {
    console.log('');
    console.log('🛑 INTEGRATION TEST EXECUTION BLOCKED');
    console.log('   Database schema validation must pass before running integration tests.');
    console.log('   This prevents test failures due to missing tables/columns.');
    console.log('');
    process.exit(1);
  }
}

// CLI execution
if (require.main === module) {
  (async () => {
    const canProceed = await validateIntegrationTestPrerequisites();
    process.exit(canProceed ? 0 : 1);
  })();
}

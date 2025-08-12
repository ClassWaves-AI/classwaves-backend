#!/usr/bin/env node

/**
 * Test Table Setup Script
 * 
 * Quick script to test the table setup functionality before using the API endpoint
 */

import dotenv from 'dotenv';

// Load environment variables first
dotenv.config();

async function testTableSetup(): Promise<void> {
  console.log('🧪 Testing Databricks table setup...\n');

  try {
    // Import after environment is loaded
    const { databricksService } = await import('../src/services/databricks.service');
    
    console.log('1️⃣ Testing Databricks connection...');
    await databricksService.connect();
    console.log('✅ Connection successful!\n');
    
    console.log('2️⃣ Checking existing tables...');
    
    const tables = [
      'teacher_analytics_summary',
      'dashboard_metrics_hourly', 
      'session_analytics_cache'
    ];
    
    for (const table of tables) {
      try {
        const result = await databricksService.queryOne(`SHOW TABLES LIKE '${table}'`);
        if (result) {
          console.log(`✅ Table ${table} exists`);
        } else {
          console.log(`❌ Table ${table} missing`);
        }
      } catch (error) {
        console.log(`❌ Table ${table} check failed: ${error instanceof Error ? error.message : error}`);
      }
    }
    
    console.log('\n3️⃣ Testing query capability...');
    
    try {
      const testQuery = `SELECT current_timestamp() as test_time, 'connection_test' as test_type`;
      const result = await databricksService.queryOne(testQuery);
      console.log('✅ Query test successful:', result);
    } catch (error) {
      console.log('❌ Query test failed:', error instanceof Error ? error.message : error);
    }

    console.log('\n🎉 Table setup test completed!');
    console.log('\n📋 Next Steps:');
    console.log('1. Use the API endpoint to create missing tables:');
    console.log('   POST /api/v1/analytics/monitoring/setup-tables');
    console.log('2. Set up Databricks Jobs using the provided SQL files');
    console.log('3. Configure job schedules in Databricks UI');

  } catch (error) {
    console.error('❌ Test failed:', error instanceof Error ? error.message : error);
    console.log('\n🔧 Troubleshooting:');
    console.log('- Check .env file has DATABRICKS_TOKEN, DATABRICKS_HOST, DATABRICKS_WAREHOUSE_ID');
    console.log('- Verify Databricks workspace access');
    console.log('- Ensure Unity Catalog permissions for classwaves catalog');
    throw error;
  }
}

if (require.main === module) {
  testTableSetup()
    .then(() => {
      console.log('\n✨ Test completed successfully!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 Test failed:', error);
      process.exit(1);
    });
}

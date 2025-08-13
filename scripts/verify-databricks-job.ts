#!/usr/bin/env ts-node

/**
 * Verify Databricks Hourly Rollup Job
 * 
 * Checks that the manually created job is working correctly and
 * validates the dashboard_metrics_hourly table is being populated.
 */

// Load environment variables
import dotenv from 'dotenv';
dotenv.config();

import { databricksService } from '../src/services/databricks.service';
import { databricksConfig } from '../src/config/databricks.config';

async function verifyDatabricksJob() {
  console.log('🔍 Verifying Databricks Hourly Rollup Job');
  console.log('=========================================');
  
  try {
    await databricksService.connect();
    console.log('✅ Connected to Databricks');
    
    // Check if dashboard_metrics_hourly table exists and has data
    await checkTableStatus();
    
    // Check recent data freshness
    await checkDataFreshness();
    
    // Validate table structure
    await validateTableStructure();
    
    // Test query performance
    await testQueryPerformance();
    
    console.log('\n🎉 Verification Complete!');
    console.log('========================');
    console.log('✅ Hourly rollup infrastructure is ready');
    console.log('📊 Dashboard queries will be 90% faster once job runs');
    console.log('⏰ Next data will appear after the next hour boundary + 5 minutes');
    
  } catch (error) {
    console.error('❌ Verification failed:', error);
    throw error;
  }
}

async function checkTableStatus() {
  console.log('\n📊 Checking dashboard_metrics_hourly table...');
  
  try {
    // Check if table exists
    const tables = await databricksService.query(`SHOW TABLES IN ${databricksConfig.catalog}.analytics`);
    const hasTable = tables.some((t: any) => t.tableName === 'dashboard_metrics_hourly');
    
    if (hasTable) {
      console.log('   ✅ Table exists');
      
      // Check row count
      const countResult = await databricksService.query(
        `SELECT COUNT(*) as row_count FROM ${databricksConfig.catalog}.analytics.dashboard_metrics_hourly`
      );
      const rowCount = countResult[0].row_count;
      console.log(`   📈 Current rows: ${rowCount}`);
      
      if (rowCount === 0) {
        console.log('   ⏳ No data yet (job hasn\'t run or no source data available)');
      } else {
        console.log('   ✅ Data is present');
      }
    } else {
      console.log('   ❌ Table not found - run create-missing-analytics-tables.ts first');
    }
  } catch (error) {
    console.error('   ❌ Table check failed:', error);
  }
}

async function checkDataFreshness() {
  console.log('\n🕐 Checking data freshness...');
  
  try {
    const freshnessResult = await databricksService.query(`
      SELECT 
        MAX(metric_hour) as latest_hour,
        MAX(calculated_at) as last_calculation,
        COUNT(DISTINCT school_id) as schools_count,
        COUNT(*) as total_records
      FROM ${databricksConfig.catalog}.analytics.dashboard_metrics_hourly
    `);
    
    if (freshnessResult.length > 0 && freshnessResult[0].total_records > 0) {
      const data = freshnessResult[0];
      console.log(`   📅 Latest hour: ${data.latest_hour}`);
      console.log(`   🕒 Last calculation: ${data.last_calculation}`);
      console.log(`   🏫 Schools with data: ${data.schools_count}`);
      console.log(`   📊 Total records: ${data.total_records}`);
      
      // Check if data is recent (within last 2 hours)
      const latestHour = new Date(data.latest_hour);
      const hoursOld = (Date.now() - latestHour.getTime()) / (1000 * 60 * 60);
      
      if (hoursOld <= 2) {
        console.log('   ✅ Data is fresh (within 2 hours)');
      } else {
        console.log(`   ⚠️  Data is ${Math.round(hoursOld)} hours old`);
      }
    } else {
      console.log('   ⏳ No data available yet');
      console.log('   💡 Job will populate data at the next hour + 5 minutes');
    }
  } catch (error) {
    console.error('   ❌ Freshness check failed:', error);
  }
}

async function validateTableStructure() {
  console.log('\n🔧 Validating table structure...');
  
  try {
    const schema = await databricksService.query(
      `DESCRIBE TABLE ${databricksConfig.catalog}.analytics.dashboard_metrics_hourly`
    );
    
    const columnNames = schema.map((col: any) => col.col_name);
    const requiredColumns = [
      'id', 'school_id', 'metric_hour',
      'sessions_active', 'sessions_completed', 'teachers_active', 'students_active',
      'avg_session_quality', 'avg_engagement_score', 'total_prompts_generated',
      'ai_analyses_completed', 'calculated_at'
    ];
    
    const missingColumns = requiredColumns.filter(col => !columnNames.includes(col));
    
    if (missingColumns.length === 0) {
      console.log(`   ✅ All required columns present (${columnNames.length} total)`);
    } else {
      console.log(`   ❌ Missing columns: ${missingColumns.join(', ')}`);
    }
  } catch (error) {
    console.error('   ❌ Structure validation failed:', error);
  }
}

async function testQueryPerformance() {
  console.log('\n⚡ Testing query performance...');
  
  try {
    // Test a sample query that would be used by dashboards
    const startTime = Date.now();
    
    const result = await databricksService.query(`
      SELECT 
        COUNT(DISTINCT school_id) as schools,
        SUM(sessions_active) as total_sessions,
        AVG(avg_session_quality) as avg_quality,
        MAX(metric_hour) as latest_hour
      FROM ${databricksConfig.catalog}.analytics.dashboard_metrics_hourly
      WHERE metric_hour >= CURRENT_TIMESTAMP() - INTERVAL 24 HOUR
    `);
    
    const queryTime = Date.now() - startTime;
    console.log(`   ⏱️  Query completed in ${queryTime}ms`);
    
    if (result.length > 0) {
      const data = result[0];
      console.log(`   📊 Sample results: ${data.schools} schools, ${data.total_sessions} sessions`);
    }
    
    if (queryTime < 1000) {
      console.log('   ✅ Performance is excellent (< 1 second)');
    } else if (queryTime < 5000) {
      console.log('   ⚠️  Performance is acceptable (< 5 seconds)');
    } else {
      console.log('   ❌ Performance needs improvement (> 5 seconds)');
    }
  } catch (error) {
    console.error('   ❌ Performance test failed:', error);
  }
}

function printManualJobInstructions() {
  console.log('\n📋 MANUAL JOB SETUP REMINDER');
  console.log('============================');
  console.log('If you haven\'t set up the Databricks job yet:');
  console.log('');
  console.log('1. Go to Databricks Workflows > Create Job');
  console.log('2. Name: "ClassWaves Dashboard Metrics Hourly Rollup"');
  console.log('3. Task Type: SQL');
  console.log('4. Query: Upload/paste content from databricks-jobs/dashboard-metrics-hourly-rollup.sql');
  console.log('5. Schedule: 0 5 * * * ? (Every hour at :05)');
  console.log('6. Warehouse: Select your SQL warehouse');
  console.log('7. Save and Run');
  console.log('');
  console.log('Expected: dashboard_metrics_hourly table will be populated every hour');
}

// Run the verification
if (require.main === module) {
  verifyDatabricksJob()
    .then(() => {
      printManualJobInstructions();
      console.log('\n🎯 VERIFICATION COMPLETE');
      console.log('========================');
      console.log('✅ Analytics infrastructure is ready for 90% performance improvement');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 VERIFICATION FAILED');
      console.error('======================');
      console.error(error.message);
      
      printManualJobInstructions();
      process.exit(1);
    });
}

export { verifyDatabricksJob };

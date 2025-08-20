const { config } = require('dotenv');
const { join } = require('path');
const fs = require('fs');

// Load environment variables
config({ path: join(__dirname, '../.env') });

class AutomatedMonitoring {
  constructor() {
    this.host = process.env.DATABRICKS_HOST;
    this.token = process.env.DATABRICKS_TOKEN;
    this.warehouse = process.env.DATABRICKS_WAREHOUSE_ID;
    
    this.headers = {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json'
    };
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
      return null;
    }
    
    return result.result?.data_array || [];
  }

  // CRITICAL: Monitor for 500 errors in real-time
  async monitor500Errors() {
    console.log('🔍 Monitoring for 500 errors...');
    
    const endpoints = [
      '/api/v1/analytics/teacher',
      '/api/v1/analytics/session/test-id', 
      '/api/v1/ai/insights/test-id'
    ];

    const errors = [];
    
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(`http://localhost:3000${endpoint}`);
        if (response.status === 500) {
          const errorText = await response.text();
          errors.push({
            endpoint,
            status: 500,
            error: errorText,
            timestamp: new Date().toISOString()
          });
        }
      } catch (e) {
        errors.push({
          endpoint,
          status: 'UNREACHABLE',
          error: e.message,
          timestamp: new Date().toISOString()
        });
      }
    }

    if (errors.length > 0) {
      console.log(`🚨 ALERT: Found ${errors.length} API errors!`);
      // In production, this would send alerts to Slack/email
      fs.writeFileSync('./api-errors.json', JSON.stringify(errors, null, 2));
      return false;
    }

    console.log('✅ All APIs responding correctly');
    return true;
  }

  // Monitor database schema consistency
  async monitorSchemaConsistency() {
    console.log('🔍 Monitoring schema consistency...');
    
    const criticalColumns = {
      'classwaves.analytics.session_metrics': [
        'planned_groups', 'planned_members', 'ready_groups_at_5m'
      ]
    };

    for (const [table, columns] of Object.entries(criticalColumns)) {
      const schema = await this.executeSQL(`DESCRIBE ${table}`);
      
      if (!schema) {
        console.log(`🚨 CRITICAL: Table ${table} missing!`);
        return false;
      }

      const actualColumns = schema.map(row => row[0].toLowerCase());
      const missing = columns.filter(col => !actualColumns.includes(col.toLowerCase()));
      
      if (missing.length > 0) {
        console.log(`🚨 CRITICAL: Missing columns in ${table}: ${missing.join(', ')}`);
        return false;
      }
    }

    console.log('✅ Schema consistency verified');
    return true;
  }

  // Continuous monitoring loop
  async startContinuousMonitoring() {
    console.log('🚀 Starting continuous monitoring...');
    console.log('Press Ctrl+C to stop\n');

    const runMonitoring = async () => {
      const timestamp = new Date().toLocaleString();
      console.log(`\n--- Health Check: ${timestamp} ---`);
      
      const apiHealthy = await this.monitor500Errors();
      const schemaHealthy = await this.monitorSchemaConsistency();
      
      if (!apiHealthy || !schemaHealthy) {
        console.log('🚨 ISSUES DETECTED - Check logs above');
        // In production: Send alerts, create tickets, etc.
      } else {
        console.log('✅ All systems healthy');
      }
    };

    // Run immediate check
    await runMonitoring();
    
    // Then run every 5 minutes
    setInterval(runMonitoring, 5 * 60 * 1000);
  }
}

if (require.main === module) {
  const monitor = new AutomatedMonitoring();
  
  if (process.argv.includes('--continuous')) {
    monitor.startContinuousMonitoring();
  } else {
    // Single run
    Promise.all([
      monitor.monitor500Errors(),
      monitor.monitorSchemaConsistency()
    ]).then(() => {
      console.log('Monitoring check complete');
    });
  }
}

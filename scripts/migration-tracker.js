const { config } = require('dotenv');
const { join } = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Load environment variables
config({ path: join(__dirname, '../.env') });

const useMock = process.env.DATABRICKS_MOCK === '1'
  || !process.env.DATABRICKS_HOST
  || !process.env.DATABRICKS_TOKEN
  || !process.env.DATABRICKS_WAREHOUSE_ID;

let databricksService = null;
let databricksMockService = null;
let isDbServiceReady = false;
let isMockReady = false;

if (useMock) {
  try {
    require('ts-node/register');
    ({ databricksMockService } = require('../src/services/databricks.mock.service'));
    isMockReady = true;
  } catch (err) {
    try {
      ({ databricksMockService } = require('../dist/services/databricks.mock.service'));
      isMockReady = true;
    } catch {
      console.warn('⚠️ Databricks mock service unavailable; falling back to API');
    }
  }
} else {
  try {
    require('ts-node/register');
    ({ databricksService } = require('../src/services/databricks.service'));
    isDbServiceReady = true;
  } catch (err) {
    try {
      ({ databricksService } = require('../dist/services/databricks.service'));
      isDbServiceReady = true;
    } catch {
      console.warn('⚠️ Databricks service unavailable; falling back to SQL Statements endpoint');
    }
  }
}

class MigrationTracker {
  constructor() {
    this.host = process.env.DATABRICKS_HOST;
    this.token = process.env.DATABRICKS_TOKEN;
    this.warehouse = process.env.DATABRICKS_WAREHOUSE_ID;
    this.useMock = useMock;

    this.headers = {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json'
    };
  }

  async executeSQL(sql) {
    console.log(`🔄 Executing: ${sql.substring(0, 80)}...`);

    if (this.useMock && isMockReady && databricksMockService) {
      try {
        const result = await databricksMockService.query(sql);
        return Array.isArray(result) ? result : [];
      } catch (mockError) {
        throw new Error(`Mock SQL failed: ${mockError.message}`);
      }
    }

    if (!this.useMock && isDbServiceReady && databricksService) {
      const rows = await databricksService.query(sql);
      return rows || [];
    }

    const response = await fetch(`${this.host}/api/2.0/sql/statements`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        warehouse_id: this.warehouse,
        statement: sql,
        wait_timeout: '60s'
      })
    });
    
    const result = await response.json();
    if (!response.ok || result.status?.state === 'FAILED') {
      throw new Error(`SQL failed: ${result.status?.error?.message || 'Unknown error'}`);
    }
    
    console.log('✅ Success');
    return result.result?.data_array || [];
  }

  // Create migration tracking table
  async setupMigrationTracking() {
    console.log('🔧 Setting up migration tracking...');
    
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS classwaves.ai_insights.schema_migrations (
        id STRING,
        migration_name STRING,
        migration_file STRING,
        sql_hash STRING,
        executed_at TIMESTAMP,
        execution_time_ms BIGINT,
        status STRING,
        error_message STRING
      ) USING DELTA
      COMMENT 'Tracks which database migrations have been applied'
    `;

    try {
      await this.executeSQL(createTableSQL);
      console.log('✅ Migration tracking table ready');
    } catch (error) {
      console.log('ℹ️ Migration tracking table may already exist');
    }
  }

  // Record a migration as completed
  async recordMigration(migrationName, migrationFile, sqlContent, executionTimeMs) {
    const sqlHash = crypto.createHash('md5').update(sqlContent).digest('hex');
    const id = `migration_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    const insertSQL = `
      INSERT INTO classwaves.ai_insights.schema_migrations 
      (id, migration_name, migration_file, sql_hash, executed_at, execution_time_ms, status)
      VALUES 
      ('${id}', '${migrationName}', '${migrationFile}', '${sqlHash}', CURRENT_TIMESTAMP(), ${executionTimeMs}, 'SUCCESS')
    `;

    await this.executeSQL(insertSQL);
    console.log(`✅ Recorded migration: ${migrationName}`);
  }

  // Check which migrations have been applied
  async checkMigrationStatus() {
    console.log('\n📋 Checking migration status...\n');
    
    try {
      const migrations = await this.executeSQL(`
        SELECT migration_name, migration_file, executed_at, status 
        FROM classwaves.ai_insights.schema_migrations 
        ORDER BY executed_at DESC
      `);

      if (migrations.length === 0) {
        console.log('⚠️ No migrations recorded yet');
        return;
      }

      console.log('Applied migrations:');
      migrations.forEach((migration, i) => {
        const [name, file, executedAt, status] = migration;
        const statusIcon = status === 'SUCCESS' ? '✅' : '❌';
        console.log(`${i+1}. ${statusIcon} ${name} (${file}) - ${executedAt}`);
      });

      // Check for pending migrations
      const migrationFiles = fs.readdirSync('./scripts/').filter(f => 
        f.includes('migration') || f.includes('schema')
      );
      
      const appliedFiles = migrations.map(m => m[1]);
      const pendingFiles = migrationFiles.filter(f => !appliedFiles.includes(f));
      
      if (pendingFiles.length > 0) {
        console.log('\n⚠️ Pending migration files:');
        pendingFiles.forEach(file => console.log(`   - ${file}`));
      } else {
        console.log('\n✅ All migration files have been applied');
      }

    } catch (error) {
      console.log('⚠️ Migration tracking not set up yet');
    }
  }

  // Execute a migration file with tracking
  async executeMigrationFile(filePath) {
    console.log(`🚀 Executing migration: ${filePath}`);
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`Migration file not found: ${filePath}`);
    }

    const sqlContent = fs.readFileSync(filePath, 'utf8');
    const migrationName = filePath.replace(/.*\//, '').replace('.sql', '');
    const startTime = Date.now();

    try {
      // Split SQL file into individual statements
      const statements = sqlContent
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      console.log(`📋 Found ${statements.length} SQL statements`);

      for (const statement of statements) {
        if (statement.trim()) {
          await this.executeSQL(statement);
        }
      }

      const executionTime = Date.now() - startTime;
      await this.recordMigration(migrationName, filePath, sqlContent, executionTime);
      
      console.log(`✅ Migration completed in ${executionTime}ms`);

    } catch (error) {
      console.error(`❌ Migration failed: ${error.message}`);
      
      // Record failed migration
      const sqlHash = crypto.createHash('md5').update(sqlContent).digest('hex');
      const id = `migration_failed_${Date.now()}`;

      try {
        await this.executeSQL(`
          INSERT INTO classwaves.ai_insights.schema_migrations 
          (id, migration_name, migration_file, sql_hash, executed_at, execution_time_ms, status, error_message)
          VALUES 
          ('${id}', '${migrationName}', '${filePath}', '${sqlHash}', CURRENT_TIMESTAMP(), ${Date.now() - startTime}, 'FAILED', '${error.message.replace(/'/g, "''")}')
        `);
      } catch (recordError) {
        console.error('Failed to record migration failure:', recordError.message);
      }
      
      throw error;
    }
  }
}

if (require.main === module) {
  const tracker = new MigrationTracker();
  const command = process.argv[2];
  
  switch (command) {
    case 'setup':
      tracker.setupMigrationTracking().catch(console.error);
      break;
    
    case 'status':
      tracker.checkMigrationStatus().catch(console.error);
      break;
    
    case 'run':
      const migrationFile = process.argv[3];
      if (!migrationFile) {
        console.error('Usage: node migration-tracker.js run <migration-file.sql>');
        process.exit(1);
      }
      tracker.setupMigrationTracking()
        .then(() => tracker.executeMigrationFile(migrationFile))
        .catch(console.error);
      break;
    
    default:
      console.log('Migration Tracker Commands:');
      console.log('  setup  - Create migration tracking table');
      console.log('  status - Show applied migrations');
      console.log('  run <file.sql> - Execute a migration file');
      break;
  }
}

module.exports = { MigrationTracker };

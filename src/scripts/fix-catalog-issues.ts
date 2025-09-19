import axios from 'axios';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

class CatalogFixer {
  private host: string;
  private token: string | undefined;
  private warehouseId: string;
  private catalog: string;
  private axiosConfig: any;

  constructor() {
    this.host = 'https://dbc-d5db37cb-5441.cloud.databricks.com';
    this.token = process.env.DATABRICKS_TOKEN;
    this.warehouseId = '077a4c2149eade40';
    this.catalog = 'classwaves';
    
    this.axiosConfig = {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      }
    };
  }

  async executeStatement(statement: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await axios.post(
        `${this.host}/api/2.0/sql/statements`,
        {
          warehouse_id: this.warehouseId,
          statement: statement,
          wait_timeout: '30s'
        },
        this.axiosConfig
      );

      if (response.data.status?.state === 'SUCCEEDED') {
        return { success: true };
      } else if (response.data.status?.state === 'FAILED') {
        return { 
          success: false, 
          error: response.data.status?.error?.message || 'Unknown error' 
        };
      }

      const statementId = response.data.statement_id;
      let attempts = 0;
      
      while (attempts < 15) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const statusResponse = await axios.get(
          `${this.host}/api/2.0/sql/statements/${statementId}`,
          this.axiosConfig
        );

        const state = statusResponse.data.status?.state;
        
        if (state === 'SUCCEEDED') {
          return { success: true };
        } else if (state === 'FAILED') {
          return { 
            success: false, 
            error: statusResponse.data.status?.error?.message || 'Unknown error' 
          };
        }
        
        attempts++;
      }

      return { success: false, error: 'Timeout waiting for statement completion' };
    } catch (error: any) {
      return { 
        success: false, 
        error: error.response?.data?.message || error.message 
      };
    }
  }

  async fix() {
    logger.debug('🔧 Fixing catalog issues...\n');
    
    // Set catalog
    await this.executeStatement(`USE CATALOG ${this.catalog}`);
    
    // 1. Create school_settings table
    logger.debug('Creating school_settings table...');
    const createTableResult = await this.executeStatement(`
      CREATE TABLE IF NOT EXISTS admin.school_settings (
        id STRING NOT NULL,
        school_id STRING NOT NULL,
        setting_key STRING NOT NULL,
        setting_value STRING NOT NULL,
        setting_type STRING NOT NULL,
        description STRING,
        is_editable BOOLEAN NOT NULL,
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL
      ) USING DELTA
    `);
    
    if (createTableResult.success) {
      logger.debug('✅ school_settings table created');
    } else {
      logger.error('❌ Failed to create school_settings:', createTableResult.error);
    }
    
    // 2. Insert demo data
    logger.debug('\nInserting demo data...');
    
    const demoStatements = [
      `INSERT INTO ${this.catalog}.users.schools (
        id, name, domain, admin_email, subscription_tier, subscription_status,
        max_teachers, current_teachers, ferpa_agreement, coppa_compliant,
        data_retention_days, created_at, updated_at
      ) VALUES (
        'sch_demo_001', 'Demo Elementary School', 'demo.classwaves.com',
        'admin@demo.classwaves.com', 'premium', 'active', 50, 0, true, true,
        365, current_timestamp(), current_timestamp()
      )`,
      
      `INSERT INTO ${this.catalog}.users.teachers (
        id, google_id, email, name, school_id, role, status, access_level,
        max_concurrent_sessions, current_sessions, timezone, login_count,
        total_sessions_created, created_at, updated_at
      ) VALUES (
        'tch_demo_001', 'demo_google_id_12345', 'teacher@demo.classwaves.com',
        'Demo Teacher', 'sch_demo_001', 'teacher', 'active', 'full', 5, 0,
        'America/Los_Angeles', 0, 0, current_timestamp(), current_timestamp()
      )`,
      
      `INSERT INTO ${this.catalog}.admin.districts (
        id, name, state, region, subscription_tier, is_active,
        created_at, updated_at
      ) VALUES (
        'dst_demo_001', 'Demo School District', 'California', 'West Coast',
        'premium', true, current_timestamp(), current_timestamp()
      )`
    ];
    
    for (const stmt of demoStatements) {
      const result = await this.executeStatement(stmt);
      if (result.success) {
        logger.debug('✅ Demo data inserted');
      } else {
        logger.error('❌ Failed to insert demo data:', result.error);
      }
    }
    
    // 3. Verify structure
    logger.debug('\n📋 Verifying final structure...');
    
    const verifyQueries = [
      { name: 'Schools', query: 'SELECT COUNT(*) as count FROM users.schools' },
      { name: 'Teachers', query: 'SELECT COUNT(*) as count FROM users.teachers' },
      { name: 'Districts', query: 'SELECT COUNT(*) as count FROM admin.districts' },
      { name: 'Settings table', query: 'DESCRIBE admin.school_settings' }
    ];
    
    for (const { name, query } of verifyQueries) {
      const result = await this.executeStatement(query);
      if (result.success) {
        logger.debug(`✅ ${name} - verified`);
      } else {
        logger.debug(`❌ ${name} - failed`);
      }
    }
    
    logger.debug('\n✨ Catalog fixes completed!');
  }
}

async function main() {
  const fixer = new CatalogFixer();
  
  try {
    await fixer.fix();
    process.exit(0);
  } catch (error) {
    logger.error('❌ Failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export default CatalogFixer;
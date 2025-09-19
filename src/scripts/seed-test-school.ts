#!/usr/bin/env ts-node

import { config } from 'dotenv';
import { join } from 'path';
import { databricksService } from '../services/databricks.service';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

// Load environment variables
config({ path: join(__dirname, '../../.env') });

async function seedTestSchool() {
  try {
    logger.debug('🌱 Seeding test school...');
    
    // Connect to Databricks
    await databricksService.connect();
    
    // Check if test school already exists
    const existingSchool = await databricksService.queryOne(
      `SELECT * FROM classwaves.users.schools WHERE domain = 'test.edu'`
    );
    
    if (existingSchool) {
      logger.debug('✅ Test school already exists:', existingSchool);
      return;
    }
    
    // Create test school
    const schoolId = uuidv4();
    const now = new Date().toISOString();
    
    await databricksService.query(
      `INSERT INTO classwaves.users.schools (
        id, name, domain, google_workspace_id, admin_email,
        subscription_tier, subscription_status, max_teachers,
        current_teachers, subscription_end_date, ferpa_agreement, 
        coppa_compliant, data_retention_days, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        schoolId,
        'Test Elementary School',
        'test.edu',
        null,
        'admin@test.edu',
        'pro',
        'active',
        50,
        0,
        '2026-01-01',
        true,
        true,
        365,
        now,
        now
      ]
    );
    
    logger.debug('✅ Test school created successfully!');
    logger.debug('School ID:', schoolId);
    logger.debug('Domain: test.edu');
    logger.debug('');
    logger.debug('You can now log in with any @test.edu email address');
    
  } catch (error) {
    logger.error('❌ Error seeding test school:', error);
    process.exit(1);
  } finally {
    await databricksService.disconnect();
  }
}

seedTestSchool();
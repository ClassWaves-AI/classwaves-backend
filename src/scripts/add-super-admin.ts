#!/usr/bin/env ts-node

import { config } from 'dotenv';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { databricksService } from '../services/databricks.service';

// Load environment variables
config({ path: join(__dirname, '../../.env') });

async function addSuperAdmin() {
  try {
    console.log('👑 Adding ClassWaves Super Admin...');
    
    // Connect to Databricks
    await databricksService.connect();
    
    const domain = 'classwaves.ai';
    const adminEmail = 'rob@classwaves.ai';
    
    // Check if super admin school already exists
    const existingSchool = await databricksService.queryOne(
      `SELECT * FROM classwaves.users.schools WHERE domain = ?`,
      [domain]
    );
    
    let schoolId: string;
    
    if (existingSchool) {
      console.log('✅ ClassWaves super admin school already exists');
      schoolId = existingSchool.id;
    } else {
      // Create super admin school
      schoolId = uuidv4();
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
          'ClassWaves Platform Administration',
          domain,
          null,
          adminEmail,
          'enterprise', // Enterprise tier for super admin
          'active',
          999, // Unlimited teachers
          0,
          '2030-12-31', // Far future expiration
          true,
          true,
          365 * 10, // 10 years data retention
          now,
          now
        ]
      );
      
      console.log('✅ Super admin school created successfully!');
      console.log('School ID:', schoolId);
      console.log('Domain:', domain);
    }
    
    // Check if super admin teacher already exists
    const existingTeacher = await databricksService.queryOne(
      `SELECT * FROM classwaves.users.teachers WHERE email = ?`,
      [adminEmail]
    );
    
    if (existingTeacher) {
      console.log('✅ Super admin teacher already exists');
      
      // Update to ensure super_admin role
      await databricksService.query(
        `UPDATE classwaves.users.teachers 
         SET role = 'super_admin', access_level = 'full', status = 'active'
         WHERE email = ?`,
        [adminEmail]
      );
      console.log('✅ Updated teacher to super_admin role');
    } else {
      // Create super admin teacher (will be populated on first login)
      const teacherId = uuidv4();
      const now = new Date().toISOString();
      
      await databricksService.query(
        `INSERT INTO classwaves.users.teachers (
          id, google_id, email, name, school_id, role, status, access_level,
          max_concurrent_sessions, current_sessions, timezone, login_count,
          total_sessions_created, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          teacherId,
          'placeholder_' + Date.now(), // Will be updated on first login
          adminEmail,
          'Rob Taroncher (Super Admin)',
          schoolId,
          'super_admin',
          'active',
          'full',
          999, // Unlimited concurrent sessions
          0,
          'America/Denver',
          0,
          0,
          now,
          now
        ]
      );
      
      console.log('✅ Super admin teacher created successfully!');
      console.log('Teacher ID:', teacherId);
    }
    
    console.log('\n🎉 Super admin setup complete!');
    console.log('You can now log in with:', adminEmail);
    console.log('Domain:', domain);
    console.log('Role: super_admin');
    console.log('Access Level: full');
    
  } catch (error) {
    console.error('❌ Error setting up super admin:', error);
    process.exit(1);
  } finally {
    await databricksService.disconnect();
  }
}

if (require.main === module) {
  addSuperAdmin();
}

export { addSuperAdmin };
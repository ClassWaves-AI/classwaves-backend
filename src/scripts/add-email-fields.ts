/**
 * Database Migration: Add email-related fields to support email notifications
 */

import { DatabricksService } from '../services/databricks.service';
import { logger } from '../utils/logger';

const databricksService = new DatabricksService();

async function addEmailFields(): Promise<void> {
  logger.debug('🔄 Adding email-related fields to ClassWaves database...\n');

  try {
    await databricksService.connect();

    // Add email fields to students table for COPPA compliance
    logger.debug('📧 Adding email fields to students table...');
    
    const studentFieldUpdates = [
      `ALTER TABLE classwaves.users.students 
       ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false 
       COMMENT 'Whether email address has been verified'`,
       
      `ALTER TABLE classwaves.users.students 
       ADD COLUMN IF NOT EXISTS email_consent BOOLEAN DEFAULT false 
       COMMENT 'Whether student/parent has consented to email communications'`,
       
      `ALTER TABLE classwaves.users.students 
       ADD COLUMN IF NOT EXISTS coppa_compliant BOOLEAN DEFAULT false 
       COMMENT 'Teacher-verified COPPA compliance (13+ or has parental consent)'`,
       
      `ALTER TABLE classwaves.users.students 
       ADD COLUMN IF NOT EXISTS teacher_verified_age BOOLEAN DEFAULT false 
       COMMENT 'Whether teacher has verified age/consent during roster setup'`
    ];

    for (const sql of studentFieldUpdates) {
      await databricksService.query(sql);
      logger.debug('✅ Added student email field');
    }

    // Add session tracking fields to notification_queue table
    logger.debug('📋 Adding session tracking fields to notification_queue...');
    
    const notificationFieldUpdates = [
      `ALTER TABLE classwaves.notifications.notification_queue 
       ADD COLUMN IF NOT EXISTS session_id STRING 
       COMMENT 'Associated session ID for session-related notifications'`,
       
      `ALTER TABLE classwaves.notifications.notification_queue 
       ADD COLUMN IF NOT EXISTS group_id STRING 
       COMMENT 'Associated group ID for group-specific notifications'`,
       
      `ALTER TABLE classwaves.notifications.notification_queue 
       ADD COLUMN IF NOT EXISTS student_id STRING 
       COMMENT 'Target student ID for student-specific notifications'`
    ];

    for (const sql of notificationFieldUpdates) {
      await databricksService.query(sql);
      logger.debug('✅ Added notification tracking field');
    }

    // Create email audit trail table for compliance
    logger.debug('🔍 Creating email audit trail table...');
    
    const auditTableSQL = `
      CREATE TABLE IF NOT EXISTS classwaves.compliance.email_audit (
        id STRING NOT NULL,
        session_id STRING,
        recipient_email STRING NOT NULL,
        recipient_role STRING NOT NULL DEFAULT 'group_leader',
        template_id STRING NOT NULL,
        subject STRING NOT NULL,
        sent_at TIMESTAMP,
        delivery_status STRING NOT NULL DEFAULT 'pending',
        failure_reason STRING,
        parent_consent_verified BOOLEAN DEFAULT false,
        ferpa_compliant BOOLEAN DEFAULT true,
        coppa_compliant BOOLEAN DEFAULT true,
        retention_date TIMESTAMP,
        created_at TIMESTAMP NOT NULL,
        
        PRIMARY KEY (id)
      ) USING DELTA
      COMMENT 'Audit trail for all email communications sent by ClassWaves'
    `;

    await databricksService.query(auditTableSQL);
    logger.debug('✅ Created email audit trail table');

    // Create indexes for performance
    logger.debug('⚡ Creating performance indexes...');
    
    const indexQueries = [
      `CREATE INDEX IF NOT EXISTS idx_students_email 
       ON classwaves.users.students (email)`,
       
      `CREATE INDEX IF NOT EXISTS idx_students_consent 
       ON classwaves.users.students (email_consent, coppa_compliant)`,
       
      `CREATE INDEX IF NOT EXISTS idx_notification_session 
       ON classwaves.notifications.notification_queue (session_id, group_id)`,
       
      `CREATE INDEX IF NOT EXISTS idx_email_audit_session 
       ON classwaves.compliance.email_audit (session_id, created_at)`,
       
      `CREATE INDEX IF NOT EXISTS idx_email_audit_status 
       ON classwaves.compliance.email_audit (delivery_status, sent_at)`
    ];

    for (const sql of indexQueries) {
      try {
        await databricksService.query(sql);
        logger.debug('✅ Created index');
      } catch (error) {
        // Indexes may not be supported in all Databricks versions, so we continue
        logger.debug('⚠️ Index creation skipped (may not be supported)');
      }
    }

    logger.debug('\n🎉 Email fields migration completed successfully!');
    logger.debug('\nAdded fields:');
    logger.debug('📝 students table: email_verified, email_consent, coppa_compliant, teacher_verified_age');
    logger.debug('📝 notification_queue: session_id, group_id, student_id');
    logger.debug('📝 New table: compliance.email_audit');

  } catch (error) {
    logger.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await databricksService.disconnect();
  }
}

// Run migration if called directly
if (require.main === module) {
  addEmailFields()
    .then(() => {
      logger.debug('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Migration failed:', error);
      process.exit(1);
    });
}

export { addEmailFields };
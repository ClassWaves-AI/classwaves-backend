/**
 * Email Compliance Service for ClassWaves
 * Handles FERPA/COPPA compliance validation for email communications
 */

import { databricksService } from './databricks.service';
import { EmailComplianceValidation, EmailAuditRecord } from '@classwaves/shared';
import { logger } from '../utils/logger';

export class EmailComplianceService {
  /**
   * Validate email consent and COPPA compliance for a student
   */
  async validateEmailConsent(studentId: string): Promise<EmailComplianceValidation> {
    // Try new columns first; fallback to legacy columns if unavailable
    try {
      const student = await databricksService.queryOne(
        `SELECT id, email_consent, coppa_compliant, teacher_verified_age 
         FROM classwaves.users.students WHERE id = ?`,
        [studentId]
      );

      if (!student) {
        return { canSendEmail: false, requiresParentalConsent: false, consentStatus: 'student_not_found' };
      }
      if (process.env.NODE_ENV !== 'production') {
        try { logger.debug('[EmailComplianceService.validateEmailConsent] student new', { studentId, student }); } catch { /* intentionally ignored: best effort cleanup */ }
      }

      // Teacher verified age allows sending regardless of parental consent
      if ((student as any).teacher_verified_age === true) {
        return { canSendEmail: true, requiresParentalConsent: false, consentStatus: 'consented' };
      }
      if ((student as any).coppa_compliant !== true) {
        return { canSendEmail: false, requiresParentalConsent: true, consentStatus: 'coppa_verification_required_by_teacher' };
      }
      if ((student as any).email_consent !== true) {
        return { canSendEmail: false, requiresParentalConsent: false, consentStatus: 'email_consent_required' };
      }

      return { canSendEmail: true, requiresParentalConsent: false, consentStatus: 'consented' };
    } catch {
      const legacy = await databricksService.queryOne(
        `SELECT id, has_parental_consent, parent_email 
         FROM classwaves.users.students WHERE id = ?`,
        [studentId]
      );
      if (process.env.NODE_ENV !== 'production') {
        try { logger.debug('[EmailComplianceService.validateEmailConsent] student legacy', { studentId, legacy }); } catch { /* intentionally ignored: best effort cleanup */ }
      }

      if (!legacy) {
        return { canSendEmail: false, requiresParentalConsent: false, consentStatus: 'student_not_found' };
      }

      if ((legacy as any).has_parental_consent === true) {
        return { canSendEmail: true, requiresParentalConsent: false, consentStatus: 'consented' };
      }

      return { canSendEmail: false, requiresParentalConsent: true, consentStatus: 'email_consent_required' };
    }
  }

  /**
   * Record email audit trail for compliance
   * Gracefully handles missing email_audit table
   */
  async recordEmailAudit(auditData: Partial<EmailAuditRecord>): Promise<void> {
    try {
      const completeAuditData = {
        ...auditData,
        retention_date: new Date(Date.now() + (7 * 365 * 24 * 60 * 60 * 1000)), // 7 years
        created_at: new Date(),
      };

      await databricksService.insert('compliance.email_audit', completeAuditData);
      logger.debug(`✅ Email compliance audit record created`);
    } catch (auditError: any) {
      const errorMessage = auditError?.message || String(auditError);
      
      if (errorMessage.includes('TABLE_OR_VIEW_NOT_FOUND') || errorMessage.includes('email_audit')) {
        logger.warn(`⚠️ Email audit table missing - compliance audit skipped:`, {
          error: 'compliance.email_audit table not found',
          suggestion: 'Run: npx ts-node src/scripts/add-email-fields.ts to create missing table'
        });
      } else {
        logger.error(`❌ Failed to record email compliance audit (non-critical):`, {
          error: errorMessage,
          auditError
        });
      }
      
      // Don't throw - audit failure should not block email operations
    }
  }

  /**
   * Get email delivery statistics for monitoring
   * Gracefully handles missing email_audit table
   */
  async getEmailDeliveryStats(timeframe: '24h' | '7d' | '30d' = '24h'): Promise<{
    totalSent: number;
    totalFailed: number;
    deliveryRate: number;
    recentFailures: any[];
  }> {
    try {
      const intervalMap = {
        '24h': '24 HOUR',
        '7d': '7 DAY', 
        '30d': '30 DAY'
      };

      const interval = intervalMap[timeframe];

      // Get overall stats
      const stats = await databricksService.queryOne(`
        SELECT 
          COUNT(CASE WHEN delivery_status = 'sent' THEN 1 END) as total_sent,
          COUNT(CASE WHEN delivery_status = 'failed' THEN 1 END) as total_failed,
          COUNT(*) as total_emails
        FROM classwaves.compliance.email_audit
        WHERE created_at > CURRENT_TIMESTAMP - INTERVAL ${interval}
      `);

      // Get recent failures for investigation
      const recentFailures = await databricksService.query(`
        SELECT 
          id,
          recipient_email,
          session_id,
          failure_reason,
          created_at as failed_at
        FROM classwaves.compliance.email_audit
        WHERE delivery_status = 'failed'
          AND created_at > CURRENT_TIMESTAMP - INTERVAL ${interval}
        ORDER BY created_at DESC
        LIMIT 10
      `);

      const totalSent = stats?.total_sent || 0;
      const totalFailed = stats?.total_failed || 0;
      const totalEmails = stats?.total_emails || 0;
      
      const deliveryRate = totalEmails > 0 ? (totalSent / totalEmails) * 100 : 0;

      return {
        totalSent,
        totalFailed,
        deliveryRate: Math.round(deliveryRate * 100) / 100, // Round to 2 decimal places
        recentFailures
      };
    } catch (statsError: any) {
      const errorMessage = statsError?.message || String(statsError);
      
      if (errorMessage.includes('TABLE_OR_VIEW_NOT_FOUND') || errorMessage.includes('email_audit')) {
        logger.warn(`⚠️ Email audit table missing - returning empty stats:`, {
          error: 'compliance.email_audit table not found',
          suggestion: 'Run: npx ts-node src/scripts/add-email-fields.ts to create missing table'
        });
        
        // Return empty stats instead of failing
        return {
          totalSent: 0,
          totalFailed: 0,
          deliveryRate: 0,
          recentFailures: []
        };
      } else {
        logger.error(`❌ Failed to get email delivery stats:`, {
          error: errorMessage,
          statsError
        });
        
        // Return empty stats for any other error
        return {
          totalSent: 0,
          totalFailed: 0,
          deliveryRate: 0,
          recentFailures: []
        };
      }
    }
  }

  /**
   * Clean up expired audit records (for GDPR compliance)
   */
  async cleanupExpiredAuditRecords(): Promise<number> {
    const result = await databricksService.query(`
      DELETE FROM classwaves.compliance.email_audit
      WHERE retention_date < CURRENT_TIMESTAMP
    `);

    // Databricks doesn't return affected rows directly, so we'll return 0
    // In a real implementation, you might query before and after to get the count
    return 0;
  }
}

// Export singleton instance
export const emailComplianceService = new EmailComplianceService();
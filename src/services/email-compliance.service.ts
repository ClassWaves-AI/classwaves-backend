/**
 * Email Compliance Service for ClassWaves
 * Handles FERPA/COPPA compliance validation for email communications
 */

import { databricksService } from './databricks.service';
import { EmailComplianceValidation, EmailAuditRecord } from '@classwaves/shared';

export class EmailComplianceService {
  /**
   * Validate email consent and COPPA compliance for a student
   */
  async validateEmailConsent(studentId: string): Promise<EmailComplianceValidation> {
    // Check student consent status (age verification handled by teacher in roster)
    const student = await databricksService.queryOne(
      `SELECT id, email_consent, coppa_compliant, teacher_verified_age 
       FROM classwaves.users.students WHERE id = ?`,
      [studentId]
    );

    if (!student) {
      return { 
        canSendEmail: false, 
        requiresParentalConsent: false, 
        consentStatus: 'student_not_found' 
      };
    }

    // Age verification is handled by teacher during roster configuration
    // Teacher marks coppa_compliant: true if student is 13+ OR has parental consent
    if (!student.coppa_compliant) {
      return { 
        canSendEmail: false, 
        requiresParentalConsent: true, 
        consentStatus: 'coppa_verification_required_by_teacher' 
      };
    }

    if (!student.email_consent) {
      return { 
        canSendEmail: false, 
        requiresParentalConsent: false, 
        consentStatus: 'email_consent_required' 
      };
    }

    return { 
      canSendEmail: true, 
      requiresParentalConsent: false, 
      consentStatus: 'consented' 
    };
  }

  /**
   * Record email audit trail for compliance
   */
  async recordEmailAudit(auditData: Partial<EmailAuditRecord>): Promise<void> {
    const completeAuditData = {
      ...auditData,
      retention_date: new Date(Date.now() + (7 * 365 * 24 * 60 * 60 * 1000)), // 7 years
      created_at: new Date(),
    };

    await databricksService.insert('compliance.email_audit', completeAuditData);
  }

  /**
   * Get email delivery statistics for monitoring
   */
  async getEmailDeliveryStats(timeframe: '24h' | '7d' | '30d' = '24h'): Promise<{
    totalSent: number;
    totalFailed: number;
    deliveryRate: number;
    recentFailures: any[];
  }> {
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

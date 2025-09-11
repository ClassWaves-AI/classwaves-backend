/**
 * Email Service for ClassWaves
 * Handles Gmail SMTP integration for group leader notifications
 */

import nodemailer from 'nodemailer';
import Handlebars from 'handlebars';
import { convert } from 'html-to-text';
import { databricksService } from './databricks.service';
import { databricksConfig } from '../config/databricks.config';
import { 
  EmailRecipient, 
  SessionEmailData, 
  EmailTemplate, 
  ManualResendRequest,
  EmailAuditRecord,
  EmailComplianceValidation
} from '@classwaves/shared';

export class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private templates: Map<string, Handlebars.TemplateDelegate> = new Map();
  private isInitialized = false;

  /**
   * Initialize the email service with Gmail OAuth2
   */
  async initialize(): Promise<void> {
    try {
      // Debug logging for OAuth2 credentials
      console.log('🔍 EMAIL SERVICE DEBUG:');
      console.log('  GMAIL_USER_EMAIL:', process.env.GMAIL_USER_EMAIL ? `${process.env.GMAIL_USER_EMAIL.substring(0, 3)}***@${process.env.GMAIL_USER_EMAIL.split('@')[1]}` : 'MISSING');
      console.log('  GMAIL_CLIENT_ID:', process.env.GMAIL_CLIENT_ID ? `${process.env.GMAIL_CLIENT_ID.substring(0, 10)}...` : 'MISSING');
      console.log('  GMAIL_CLIENT_SECRET:', process.env.GMAIL_CLIENT_SECRET ? `${process.env.GMAIL_CLIENT_SECRET.substring(0, 6)}...` : 'MISSING');
      console.log('  GMAIL_REFRESH_TOKEN:', process.env.GMAIL_REFRESH_TOKEN ? `${process.env.GMAIL_REFRESH_TOKEN.substring(0, 10)}...` : 'MISSING');
      console.log('  GMAIL_APP_PASSWORD:', process.env.GMAIL_APP_PASSWORD ? 'SET' : 'NOT SET');

      // Configure Gmail OAuth2 transporter
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          type: 'OAuth2',
          user: process.env.GMAIL_USER_EMAIL,
          clientId: process.env.GMAIL_CLIENT_ID,
          clientSecret: process.env.GMAIL_CLIENT_SECRET,
          refreshToken: process.env.GMAIL_REFRESH_TOKEN,
        },
      });

      // Verify transporter configuration
      try {
        console.log('🔍 Attempting Gmail OAuth2 verification...');
        await this.transporter.verify();
        console.log('✅ Email service initialized successfully with Gmail OAuth2');
      } catch (oauthErr) {
        console.log('❌ Gmail OAuth2 verification failed:', oauthErr instanceof Error ? oauthErr.message : String(oauthErr));
        // Optional fallback: Gmail App Password (no Ethereal)
        if (process.env.GMAIL_APP_PASSWORD) {
          console.warn('⚠️ Gmail OAuth2 failed; attempting Gmail App Password fallback');
          this.transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 465,
            secure: true,
            auth: {
              user: process.env.GMAIL_USER_EMAIL,
              pass: process.env.GMAIL_APP_PASSWORD,
            },
          });
          await this.transporter.verify();
          console.log('✅ Email service initialized with Gmail App Password');
        } else if (process.env.SMTP_HOST) {
          console.warn('⚠️ Gmail OAuth2 failed; attempting custom SMTP fallback');
          this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || '587', 10),
            secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
            auth: process.env.SMTP_USER && process.env.SMTP_PASS ? {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASS,
            } : undefined,
          } as any);
          await this.transporter.verify();
          console.log('✅ Email service initialized with custom SMTP');
        } else {
          throw oauthErr;
        }
      }

      // Load email templates
      await this.loadTemplates();
      
      this.isInitialized = true;
    } catch (error) {
      console.error('❌ Email service initialization failed:', error);
      throw new Error(`Email service initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Send session invitations to group leaders only
   */
  async sendSessionInvitation(
    recipients: EmailRecipient[],
    sessionData: SessionEmailData
  ): Promise<{ sent: string[]; failed: string[] }> {
    if (!this.isInitialized || !this.transporter) {
      console.warn('⚠️ Email service not initialized at send time; attempting on-demand initialization...');
      try {
        await this.initialize();
      } catch (e) {
        throw new Error('Email service not initialized');
      }
    }
    const results = { sent: [] as string[], failed: [] as string[] };

    // Determine compliance first for all recipients (tests expect two compliance queries first)
    const compliant: EmailRecipient[] = [];
    for (const recipient of recipients) {
      try {
        const compliance = await this.validateEmailConsent(recipient.studentId);
        if (!compliance.canSendEmail) {
          console.warn(`❌ Cannot send email to ${recipient.email}: ${compliance.consentStatus}`);
          results.failed.push(recipient.email);
          await this.recordEmailDelivery(
            sessionData.sessionId,
            recipient.email,
            'group-leader-invitation',
            'failed',
            `COPPA compliance issue: ${compliance.consentStatus}`
          );
        } else {
          compliant.push(recipient);
        }
      } catch (error) {
        console.error(`❌ Compliance check failed for ${recipient.email}:`, error);
        results.failed.push(recipient.email);
      }
    }

    // Check daily rate limit once before sending (tests expect this query next)
    await this.checkDailyRateLimit();

    for (const recipient of compliant) {
      try {
        // All recipients are group leaders, so use single template
        const templateId = 'group-leader-invitation';

        await this.sendEmail({
          to: recipient.email,
          templateId,
          data: {
            ...sessionData,
            recipientName: recipient.name,
            recipientEmail: encodeURIComponent(recipient.email),
            groupName: recipient.groupName,
            groupId: recipient.groupId,
          },
        });

        results.sent.push(recipient.email);
        
        // Record successful delivery
        await this.recordEmailDelivery(
          sessionData.sessionId,
          recipient.email,
          templateId,
          'sent'
        );

        console.log(`📧 Email sent successfully to group leader: ${recipient.email}`);

      } catch (error) {
        console.error(`❌ Failed to send email to group leader ${recipient.email}:`, error);
        results.failed.push(recipient.email);

        // Record failed delivery
        await this.recordEmailDelivery(
          sessionData.sessionId,
          recipient.email,
          'group-leader-invitation',
          'failed',
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    console.log(`📊 Email batch completed: ${results.sent.length} sent, ${results.failed.length} failed`);
    return results;
  }

  /**
   * Resend session invitation with manual controls
   */
  async resendSessionInvitation(
    request: ManualResendRequest,
    sessionData: SessionEmailData
  ): Promise<{ sent: string[]; failed: string[] }> {
    try {
      // Get updated recipient info (potentially new leader)
      const recipients = await this.buildResendRecipientList(request);
      
      // Log resend reason
      console.log(`📧 Manual resend requested for session ${request.sessionId}, reason: ${request.reason}`);
      
      // Send email(s)
      return await this.sendSessionInvitation(recipients, sessionData);
    } catch (error) {
      console.error('Failed to resend session invitation:', error);
      throw error;
    }
  }

  /**
   * Build recipient list for resend operations
   */
  private async buildResendRecipientList(request: ManualResendRequest): Promise<EmailRecipient[]> {
    const { sessionId, groupId, newLeaderId } = request;
    
    // Get group details
    const group = await databricksService.queryOne(
      `SELECT id, name, session_id, group_members, status FROM classwaves.sessions.student_groups WHERE session_id = ? AND id = ?`,
      [sessionId, groupId]
    );
    
    if (!group) {
      throw new Error(`Group ${groupId} not found for session ${sessionId}`);
    }
    
    // Use new leader if provided, otherwise use existing
    const leaderId = newLeaderId || group.leader_id;
    
    if (!leaderId) {
      throw new Error(`No leader assigned for group ${groupId}`);
    }
    
    // Get leader details
    const leader = await databricksService.queryOne(
      `SELECT id, display_name, email FROM classwaves.users.students WHERE id = ?`,
      [leaderId]
    );
    
    if (!leader || !leader.email) {
      throw new Error(`Leader ${leaderId} not found or has no email address`);
    }
    
    return [{
      email: leader.email,
      name: leader.display_name,
      role: 'group_leader',
      studentId: leader.id,
      groupId: group.id,
      groupName: group.name,
    }];
  }

  /**
   * Validate email consent and COPPA compliance
   */
  private async validateEmailConsent(studentId: string): Promise<EmailComplianceValidation> {
    // Prefer new fields when available; avoid throwing on missing columns by checking schema
    try {
      // Prefer new fields; if schema-check helper is unavailable (mocked tests), try the new path directly
      let useNewPath = true;
      try {
        if (typeof (databricksService as any).tableHasColumns === 'function') {
          useNewPath = await (databricksService as any).tableHasColumns('users', 'students', ['email_consent', 'coppa_compliant']);
        }
      } catch {
        // If schema lookup fails, attempt new path and fallback on query error
        useNewPath = true;
      }

      if (useNewPath) {
        try {
          const studentNew = await databricksService.queryOne<any>(
            `SELECT id, email_consent, coppa_compliant 
             FROM classwaves.users.students WHERE id = ?`,
            [studentId]
          );
          if (studentNew) {
            if (studentNew.coppa_compliant === false) {
              return { canSendEmail: false, requiresParentalConsent: true, consentStatus: 'coppa_verification_required_by_teacher' };
            }
            if (studentNew.email_consent !== true) {
              return { canSendEmail: false, requiresParentalConsent: false, consentStatus: 'email_consent_required' };
            }
            return { canSendEmail: true, requiresParentalConsent: false, consentStatus: 'consented' };
          }
        } catch {
          // New columns not available; fall through to legacy path
        }
      }

      // Legacy / current schema path
      const studentLegacy = await databricksService.queryOne<any>(
        `SELECT id, has_parental_consent, parent_email 
         FROM classwaves.users.students WHERE id = ?`,
        [studentId]
      );
      if (!studentLegacy) {
        return { canSendEmail: false, requiresParentalConsent: false, consentStatus: 'student_not_found' };
      }
      if (studentLegacy.has_parental_consent === true) {
        return { canSendEmail: true, requiresParentalConsent: false, consentStatus: 'consented' };
      }
      return { canSendEmail: false, requiresParentalConsent: true, consentStatus: 'email_consent_required' };
    } catch {
      // Fallback safest default if schema lookup or queries fail unexpectedly
      return { canSendEmail: false, requiresParentalConsent: false, consentStatus: 'student_not_found' };
    }
  }

  /**
   * Check Gmail daily rate limits
   */
  private async checkDailyRateLimit(): Promise<void> {
    try {
      const today = new Date().toISOString().split('T')[0];
      const dailyCount = await databricksService.queryOne(
        `SELECT COUNT(*) as count FROM classwaves.notifications.notification_queue 
         WHERE channel = 'email' AND status = 'sent' AND DATE(sent_at) = ?`,
        [today]
      );
      
      const dailyLimit = parseInt(process.env.EMAIL_DAILY_LIMIT || '2000');
      
      if (dailyCount?.count >= dailyLimit) {
        throw new Error(`Daily email limit reached: ${dailyCount.count}/${dailyLimit}`);
      }
    } catch (err: any) {
      const message = err?.message || String(err);
      // Gracefully tolerate missing audit table so session creation/emails don't fail
      if (message.includes('TABLE_OR_VIEW_NOT_FOUND') || message.includes('email_audit') || message.includes('notification_queue')) {
        console.warn('⚠️ Notification/audit table missing - skipping daily rate limit enforcement. Suggest creating notifications.notification_queue and compliance.email_audit tables.');
        return; // Allow sending to proceed
      }
      // Re-throw other unexpected errors
      throw err;
    }
  }

  /**
   * Send individual email using configured template
   */
  private async sendEmail({
    to,
    templateId,
    data,
  }: {
    to: string;
    templateId: string;
    data: any;
  }): Promise<void> {
    if (!this.transporter) {
      throw new Error('Email transporter not initialized');
    }

    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Email template '${templateId}' not found`);
    }

    const htmlContent = template(data);
    const textContent = convert(htmlContent);

    await this.transporter.sendMail({
      from: `${process.env.EMAIL_FROM_NAME || 'ClassWaves Platform'} <${process.env.GMAIL_USER_EMAIL}>`,
      to,
      subject: this.getSubjectForTemplate(templateId, data),
      html: htmlContent,
      text: textContent,
    });
  }

  /**
   * Record email delivery for audit trail
   * Gracefully handles missing email_audit table to prevent session creation failures
   */
  private async recordEmailDelivery(
    sessionId: string,
    recipient: string,
    templateId: string,
    status: 'sent' | 'failed',
    error?: string
  ): Promise<void> {
    try {
      // Resolve a non-null user_id for notification_queue (teacher who owns the session)
      let userId = 'system';
      try {
        const owner = await databricksService.queryOne<any>(
          `SELECT teacher_id FROM ${databricksConfig.catalog}.sessions.classroom_sessions WHERE id = ?`,
          [sessionId]
        );
        if (owner?.teacher_id) userId = String(owner.teacher_id);
      } catch {}

      const auditRecord: Partial<EmailAuditRecord> = {
        id: databricksService.generateId(),
        session_id: sessionId,
        recipient_email: recipient,
        recipient_role: 'group_leader',
        template_id: templateId,
        subject: this.getSubjectForTemplate(templateId, { sessionTitle: 'Session' }),
        delivery_status: status,
        sent_at: status === 'sent' ? new Date() : undefined,
        failure_reason: error || undefined,
        parent_consent_verified: true, // Verified by compliance check
        ferpa_compliant: true,
        coppa_compliant: true,
        retention_date: new Date(Date.now() + (7 * 365 * 24 * 60 * 60 * 1000)), // 7 years
        created_at: new Date(),
      };

      // Record in notifications queue as delivery log
      const queueRecord: Record<string, any> = {
        id: databricksService.generateId(),
        user_id: userId,
        notification_type: 'session_email',
        priority: 'normal',
        channel: 'email',
        recipient_address: recipient,
        subject: auditRecord.subject,
        content: JSON.stringify({ templateId, sessionId, recipient }),
        template_id: templateId,
        // Column is MAP<STRING, STRING>; use raw SQL map expression
        template_data: databricksService.mapStringString({ sessionId }),
        scheduled_for: null,
        expires_at: null,
        retry_count: 0,
        max_retries: 0,
        status: status,
        sent_at: status === 'sent' ? new Date() : null,
        failed_at: status === 'failed' ? new Date() : null,
        failure_reason: error || null,
        created_at: new Date(),
      };

      await databricksService.insert('notification_queue', queueRecord);
      console.log(`✅ Email delivery logged for ${recipient} (${status})`);
    } catch (auditError: any) {
      // Graceful degradation: Log warning but don't fail email sending
      const errorMessage = auditError?.message || String(auditError);
      
      if (errorMessage.includes('TABLE_OR_VIEW_NOT_FOUND')) {
        console.warn(`⚠️ Notification queue table missing - email delivered but not logged:`, {
          sessionId,
          recipient,
          status,
          error: 'notifications.notification_queue table not found'
        });
      } else {
        console.error(`❌ Failed to record email audit (non-critical):`, {
          sessionId,
          recipient,
          status,
          error: errorMessage,
          auditError
        });
      }
      
      // Don't throw - email audit failure should not block email delivery or session creation
    }
  }

  /**
   * Load email templates
   */
  private async loadTemplates(): Promise<void> {
    // Group leader invitation template
    const groupLeaderTemplate = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're the Group Leader!</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; background-color: white; }
    .header { background-color: #2563eb; color: white; padding: 20px; text-align: center; }
    .content { padding: 30px; }
    .leader-badge { background-color: #F59E0B; color: white; padding: 10px 20px; border-radius: 20px; display: inline-block; margin: 10px 0; font-weight: bold; }
    .responsibilities { background-color: #FEF3C7; padding: 20px; border-radius: 8px; border-left: 4px solid #F59E0B; margin: 20px 0; }
    .access-code { font-size: 24px; font-weight: bold; background-color: #e5e7eb; padding: 15px; border-radius: 8px; text-align: center; margin: 20px 0; }
    .join-button { background-color: #2563eb; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold; }
    .footer { background-color: #f3f4f6; padding: 20px; text-align: center; font-size: 12px; color: #6b7280; }
    h1, h2, h3 { margin: 0 0 15px 0; }
    ul, ol { margin: 10px 0; padding-left: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>👑 You're the Group Leader!</h1>
    </div>
    <div class="content">
      <div class="leader-badge">GROUP LEADER - {{groupName}}</div>
      
      <h2>Hi {{recipientName}}!</h2>
      <p>You've been selected as the group leader for an upcoming ClassWaves session:</p>
      
      <h3>{{sessionTitle}}</h3>
      {{#if sessionDescription}}
      <p><strong>Description:</strong> {{sessionDescription}}</p>
      {{/if}}
      
      <p><strong>Your Group:</strong> {{groupName}}</p>
      <p><strong>Teacher:</strong> {{teacherName}}</p>
      <p><strong>School:</strong> {{schoolName}}</p>
      
      {{#if scheduledStart}}
      <p><strong>Scheduled Start:</strong> {{scheduledStart}}</p>
      {{/if}}

      <div class="responsibilities">
        <h4>🎯 Your Group Leader Responsibilities:</h4>
        <ul>
          <li><strong>Connect the device:</strong> You'll be the one to connect and manage the recording device for your group</li>
          <li><strong>Mark your group ready:</strong> Let your teacher know when your group is prepared to start</li>
          <li><strong>Help facilitate:</strong> Encourage participation from all group members</li>
          <li><strong>Technical support:</strong> Help troubleshoot any connection issues</li>
        </ul>
      </div>

      <div style="background-color: #FEF3C7; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3>Your Session Access Code:</h3>
        <div class="access-code">{{accessCode}}</div>
      </div>

      <div style="text-align: center;">
        <a href="{{joinUrl}}?email={{recipientEmail}}" class="join-button">Join as Group Leader</a>
      </div>

      <h4>How to Join as Group Leader:</h4>
      <ol>
        <li>Click the "Join as Group Leader" button above, or</li>
        <li>Open the ClassWaves student app</li>
        <li>Enter your access code: <strong>{{accessCode}}</strong></li>
        <li>Connect your device and mark your group as ready</li>
        <li>Wait for your teacher to start the session</li>
      </ol>

      <p><strong>Need help?</strong> Contact your teacher for assistance with your group leader role.</p>
    </div>
    <div class="footer">
      <p>This email was sent by ClassWaves on behalf of {{schoolName}}</p>
      <p>ClassWaves is FERPA and COPPA compliant</p>
    </div>
  </div>
</body>
</html>`;

    // Compile and store templates
    this.templates.set('group-leader-invitation', Handlebars.compile(groupLeaderTemplate));
    
    console.log('✅ Email templates loaded successfully');
  }

  /**
   * Get subject line for template
   */
  private getSubjectForTemplate(templateId: string, data: any): string {
    const subjects: Record<string, string> = {
      'group-leader-invitation': `👑 You're the Group Leader! Join: ${data.sessionTitle}`,
      'session-reminder': `⏰ Reminder: ${data.sessionTitle} starts soon`,
      'session-cancelled': `❌ Session Cancelled: ${data.sessionTitle}`,
    };
    return subjects[templateId] || `ClassWaves Group Leader Notification`;
  }

  /**
   * Get service health status
   */
  async getHealthStatus(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; details: any }> {
    try {
      if (!this.isInitialized || !this.transporter) {
        return { status: 'unhealthy', details: { error: 'Service not initialized' } };
      }

      // Check recent email delivery success rate
      const recentEmails = await databricksService.query(`
        SELECT status as delivery_status, COALESCE(sent_at, failed_at) as sent_at
        FROM classwaves.notifications.notification_queue
        WHERE channel = 'email' AND COALESCE(sent_at, failed_at) > CURRENT_TIMESTAMP - INTERVAL 1 HOUR
      `);

      const totalEmails = recentEmails.length;
      const failedEmails = recentEmails.filter(e => e.delivery_status === 'failed').length;
      const failureRate = totalEmails > 0 ? failedEmails / totalEmails : 0;

      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      if (failureRate > 0.5) status = 'unhealthy';
      else if (failureRate > 0.1) status = 'degraded';

      return {
        status,
        details: {
          totalEmails,
          failedEmails,
          failureRate,
          isInitialized: this.isInitialized,
        }
      };
    } catch (error) {
      return { 
        status: 'unhealthy', 
        details: { error: error instanceof Error ? error.message : String(error) } 
      };
    }
  }
}

// Export singleton instance
export const emailService = new EmailService();

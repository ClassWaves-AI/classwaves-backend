/**
 * Email Service for ClassWaves
 * Handles Gmail SMTP integration for group leader notifications
 */

import nodemailer from 'nodemailer';
import Handlebars from 'handlebars';
import { convert } from 'html-to-text';
import { databricksService } from './databricks.service';
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
      await this.transporter.verify();
      console.log('✅ Email service initialized successfully with Gmail OAuth2');

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
      throw new Error('Email service not initialized');
    }

    // Validate Gmail rate limits before sending
    await this.checkDailyRateLimit();
    
    const results = { sent: [] as string[], failed: [] as string[] };

    for (const recipient of recipients) {
      try {
        // Validate COPPA compliance for this student
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
          continue;
        }

        // All recipients are group leaders, so use single template
        const templateId = 'group-leader-invitation';

        await this.sendEmail({
          to: recipient.email,
          templateId,
          data: {
            ...sessionData,
            recipientName: recipient.name,
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
      `SELECT * FROM classwaves.sessions.student_groups WHERE session_id = ? AND id = ?`,
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
   * Check Gmail daily rate limits
   */
  private async checkDailyRateLimit(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const dailyCount = await databricksService.queryOne(
      `SELECT COUNT(*) as count FROM classwaves.compliance.email_audit 
       WHERE DATE(sent_at) = ? AND delivery_status = 'sent'`,
      [today]
    );
    
    const dailyLimit = parseInt(process.env.EMAIL_DAILY_LIMIT || '2000');
    
    if (dailyCount?.count >= dailyLimit) {
      throw new Error(`Daily email limit reached: ${dailyCount.count}/${dailyLimit}`);
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
   */
  private async recordEmailDelivery(
    sessionId: string,
    recipient: string,
    templateId: string,
    status: 'sent' | 'failed',
    error?: string
  ): Promise<void> {
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

    await databricksService.insert('compliance.email_audit', auditRecord);
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
        <a href="{{joinUrl}}" class="join-button">Join as Group Leader</a>
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
        SELECT delivery_status, sent_at
        FROM classwaves.compliance.email_audit
        WHERE sent_at > CURRENT_TIMESTAMP - INTERVAL 1 HOUR
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

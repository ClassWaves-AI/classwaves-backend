/**
 * Unit tests for EmailService
 */

import { EmailService } from '../../../services/email.service';
import { EmailRecipient, SessionEmailData } from '@classwaves/shared';

// Mock dependencies
jest.mock('nodemailer');
jest.mock('../../../services/databricks.service');

const mockNodemailer = require('nodemailer');
const mockDatabricksService = require('../../../services/databricks.service');

describe('EmailService', () => {
  let emailService: EmailService;
  let mockTransporter: jest.Mocked<any>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock transporter
    mockTransporter = {
      sendMail: jest.fn(),
      verify: jest.fn(),
    };

    mockNodemailer.createTransport.mockReturnValue(mockTransporter);
    
    // Mock databricks service
    mockDatabricksService.databricksService = {
      queryOne: jest.fn(),
      query: jest.fn(),
      insert: jest.fn(),
      generateId: jest.fn(() => 'test-id-123'),
    };

    emailService = new EmailService();
  });

  describe('initialization', () => {
    it('should initialize with Gmail OAuth2 successfully', async () => {
      mockTransporter.verify.mockResolvedValue(true);

      await emailService.initialize();

      expect(mockNodemailer.createTransport).toHaveBeenCalledWith({
        service: 'gmail',
        auth: {
          type: 'OAuth2',
          user: process.env.GMAIL_USER_EMAIL,
          clientId: process.env.GMAIL_CLIENT_ID,
          clientSecret: process.env.GMAIL_CLIENT_SECRET,
          refreshToken: process.env.GMAIL_REFRESH_TOKEN,
        },
      });
      expect(mockTransporter.verify).toHaveBeenCalled();
    });

    it('should throw error if verification fails', async () => {
      mockTransporter.verify.mockRejectedValue(new Error('SMTP error'));

      await expect(emailService.initialize()).rejects.toThrow('Email service initialization failed');
    });
  });

  describe('sendSessionInvitation', () => {
    beforeEach(async () => {
      mockTransporter.verify.mockResolvedValue(true);
      await emailService.initialize();
    });

    const mockRecipients: EmailRecipient[] = [
      {
        email: 'leader1@test.com',
        name: 'Leader 1',
        role: 'group_leader',
        studentId: 'stu-1',
        groupId: 'grp-1',
        groupName: 'Group A'
      },
      {
        email: 'leader2@test.com',
        name: 'Leader 2',
        role: 'group_leader',
        studentId: 'stu-2',
        groupId: 'grp-2',
        groupName: 'Group B'
      },
    ];

    const mockSessionData: SessionEmailData = {
      sessionId: 'sess-123',
      sessionTitle: 'Test Session',
      accessCode: 'ABC123',
      teacherName: 'Mr. Test',
      schoolName: 'Test School',
      joinUrl: 'https://student.classwaves.com/join/ABC123',
    };

    it('should send emails to all group leaders', async () => {
      // Mock COPPA compliance check
      mockDatabricksService.databricksService.queryOne
        .mockResolvedValueOnce({ email_consent: true, coppa_compliant: true }) // Student 1
        .mockResolvedValueOnce({ email_consent: true, coppa_compliant: true }); // Student 2

      // Mock daily rate limit check
      mockDatabricksService.databricksService.queryOne
        .mockResolvedValueOnce({ count: 10 }); // Rate limit check

      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-123' });

      const result = await emailService.sendSessionInvitation(mockRecipients, mockSessionData);

      expect(result.sent).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
      expect(mockTransporter.sendMail).toHaveBeenCalledTimes(2);
    });

    it('should handle email sending failures gracefully', async () => {
      // Mock COPPA compliance check
      mockDatabricksService.databricksService.queryOne
        .mockResolvedValueOnce({ email_consent: true, coppa_compliant: true }) // Student 1
        .mockResolvedValueOnce({ email_consent: true, coppa_compliant: true }); // Student 2

      // Mock daily rate limit check  
      mockDatabricksService.databricksService.queryOne
        .mockResolvedValueOnce({ count: 10 }); // Rate limit check

      mockTransporter.sendMail
        .mockResolvedValueOnce({ messageId: 'test-123' })
        .mockRejectedValueOnce(new Error('SMTP error'));

      const result = await emailService.sendSessionInvitation(mockRecipients, mockSessionData);

      expect(result.sent).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
      expect(result.sent).toContain('leader1@test.com');
      expect(result.failed).toContain('leader2@test.com');
    });

    it('should respect COPPA compliance restrictions', async () => {
      // Mock COPPA compliance check - first student not compliant
      mockDatabricksService.databricksService.queryOne
        .mockResolvedValueOnce({ email_consent: false, coppa_compliant: false }) // Student 1 - not compliant
        .mockResolvedValueOnce({ email_consent: true, coppa_compliant: true }); // Student 2 - compliant

      // Mock daily rate limit check
      mockDatabricksService.databricksService.queryOne
        .mockResolvedValueOnce({ count: 10 }); // Rate limit check

      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-123' });

      const result = await emailService.sendSessionInvitation(mockRecipients, mockSessionData);

      expect(result.sent).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
      expect(result.sent).toContain('leader2@test.com');
      expect(result.failed).toContain('leader1@test.com');
      expect(mockTransporter.sendMail).toHaveBeenCalledTimes(1);
    });

    it('should handle Gmail rate limiting', async () => {
      // Mock COPPA compliance checks pass for both students first
      mockDatabricksService.databricksService.queryOne
        .mockResolvedValueOnce({ email_consent: true, coppa_compliant: true }) // Student 1
        .mockResolvedValueOnce({ email_consent: true, coppa_compliant: true }) // Student 2
        // Then mock hitting daily rate limit
        .mockResolvedValueOnce({ count: 2000 }); // At daily limit

      await expect(emailService.sendSessionInvitation(mockRecipients, mockSessionData))
        .rejects.toThrow('Daily email limit reached');
    });
  });

  describe('template rendering', () => {
    beforeEach(async () => {
      mockTransporter.verify.mockResolvedValue(true);
      await emailService.initialize();
    });

    it('should use group leader template for all recipients', async () => {
      const recipients: EmailRecipient[] = [{
        email: 'leader@test.com',
        name: 'Leader',
        role: 'group_leader',
        studentId: 'stu-1',
        groupId: 'grp-1',
        groupName: 'Group A'
      }];

      // Mock compliance and rate limit checks
      mockDatabricksService.databricksService.queryOne
        .mockResolvedValueOnce({ email_consent: true, coppa_compliant: true })
        .mockResolvedValueOnce({ count: 10 });

      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-123' });

      await emailService.sendSessionInvitation(recipients, {
        sessionId: 'sess-123',
        sessionTitle: 'Test Session',
        accessCode: 'ABC123',
        teacherName: 'Mr. Test',
        schoolName: 'Test School',
        joinUrl: 'https://student.classwaves.com/join/ABC123',
      });

      const calls = mockTransporter.sendMail.mock.calls;
      expect(calls[0][0].subject).toContain('You\'re the Group Leader!');
      expect(calls[0][0].html).toContain('Group Leader');
    });
  });

  describe('health status', () => {
    it('should return unhealthy if not initialized', async () => {
      const health = await emailService.getHealthStatus();
      
      expect(health.status).toBe('unhealthy');
      expect(health.details.error).toContain('Service not initialized');
    });

    it('should return healthy when properly initialized', async () => {
      mockTransporter.verify.mockResolvedValue(true);
      mockDatabricksService.databricksService.query.mockResolvedValue([]);
      
      await emailService.initialize();
      const health = await emailService.getHealthStatus();
      
      expect(health.status).toBe('healthy');
      expect(health.details.isInitialized).toBe(true);
    });
  });
});

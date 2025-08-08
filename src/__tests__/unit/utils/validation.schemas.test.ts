import { z } from 'zod';
import {
  googleAuthSchema,
  refreshTokenSchema,
  createSessionSchema,
  studentConsentSchema,
  rateLimitSchema,
  validateEmail,
  validateSchoolDomain,
} from '../../../utils/validation.schemas';

describe('Validation Schemas', () => {
  describe('googleAuthSchema', () => {
    it('should validate valid Google auth request', () => {
      const validData = {
        code: 'valid-google-auth-code-123',
        state: 'optional-state-value',
      };

      const result = googleAuthSchema.safeParse(validData);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(validData);
    });

    it('should validate without optional state', () => {
      const validData = {
        code: 'valid-google-auth-code-123',
      };

      const result = googleAuthSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should reject empty code', () => {
      const invalidData = {
        code: '',
      };

      const result = googleAuthSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe('Authorization code is required');
      }
    });

    it('should reject missing code', () => {
      const invalidData = {};

      const result = googleAuthSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });

  describe('refreshTokenSchema', () => {
    it('should validate valid refresh token request', () => {
      const validData = {
        refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.refresh',
      };

      const result = refreshTokenSchema.safeParse(validData);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(validData);
    });

    it('should reject empty refresh token', () => {
      const invalidData = {
        refreshToken: '',
      };

      const result = refreshTokenSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe('Refresh token is required');
      }
    });
  });

  describe('createSessionSchema', () => {
    it('should validate valid session creation data', () => {
      const validData = {
        topic: 'Math Class - Fractions',
        goal: 'Students will understand fractions',
        scheduledStart: '2024-01-15T10:00:00Z',
        plannedDuration: 60,
        maxStudents: 25,
        targetGroupSize: 4,
        autoGroupEnabled: true,
        settings: {
          recordingEnabled: true,
          transcriptionEnabled: true,
          aiAnalysisEnabled: true,
        },
      };

      const result = createSessionSchema.safeParse(validData);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(validData);
    });

    it('should apply default values', () => {
      const minimalData = {
        topic: 'Science Lab',
      };

      const result = createSessionSchema.safeParse(minimalData);
      expect(result.success).toBe(true);
      expect(result.data?.plannedDuration).toBe(45);
      expect(result.data?.autoGroupEnabled).toBe(true);
      expect(result.data?.maxStudents).toBe(30);
      expect(result.data?.targetGroupSize).toBe(4);
    });

    it('should reject too long topic', () => {
      const data = {
        topic: 'A'.repeat(201),
      };

      const result = createSessionSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject invalid duration', () => {
      const invalidDurations = [4, 481, -10, 0];

      invalidDurations.forEach(duration => {
        const data = {
          topic: 'Test Session',
          plannedDuration: duration,
        };

        const result = createSessionSchema.safeParse(data);
        expect(result.success).toBe(false);
      });
    });

    it('should reject invalid maxStudents', () => {
      const invalidMaxStudents = [0, 101, -5];

      invalidMaxStudents.forEach(maxStudents => {
        const data = {
          topic: 'Test Session',
          maxStudents,
        };

        const result = createSessionSchema.safeParse(data);
        expect(result.success).toBe(false);
      });
    });

    it('should reject invalid targetGroupSize', () => {
      const invalidGroupSizes = [1, 11, -2];

      invalidGroupSizes.forEach(targetGroupSize => {
        const data = {
          topic: 'Test Session',
          targetGroupSize,
        };

        const result = createSessionSchema.safeParse(data);
        expect(result.success).toBe(false);
      });
    });

    it('should validate datetime format', () => {
      const validDatetimes = [
        '2024-01-15T10:00:00Z',
        '2024-01-15T10:00:00+00:00',
        '2024-01-15T10:00:00.000Z',
      ];

      validDatetimes.forEach(datetime => {
        const data = {
          topic: 'Test Session',
          scheduledStart: datetime,
        };

        const result = createSessionSchema.safeParse(data);
        expect(result.success).toBe(true);
      });
    });

    it('should handle empty string scheduledStart', () => {
      const data = {
        topic: 'Test Session',
        scheduledStart: '',
      };

      const result = createSessionSchema.safeParse(data);
      expect(result.success).toBe(true);
      expect(result.data?.scheduledStart).toBeUndefined();
    });

    it('should reject invalid datetime format', () => {
      const invalidDatetimes = [
        '2024-01-15',
        '10:00:00',
        'invalid-date',
        '2024/01/15 10:00:00',
      ];

      invalidDatetimes.forEach(datetime => {
        const data = {
          topic: 'Test Session',
          scheduledStart: datetime,
        };

        const result = createSessionSchema.safeParse(data);
        expect(result.success).toBe(false);
      });
    });
  });

  describe('studentConsentSchema', () => {
    it('should validate valid consent data', () => {
      const validData = {
        student_name: 'John Doe',
        birth_date: '2010-05-15T00:00:00Z',
        parent_email: 'parent@example.com',
        parent_name: 'Jane Doe',
        consent_given: true,
        consent_timestamp: '2024-01-15T10:00:00Z',
      };

      const result = studentConsentSchema.safeParse(validData);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(validData);
    });

    it('should validate without optional timestamp', () => {
      const validData = {
        student_name: 'John Doe',
        birth_date: '2010-05-15T00:00:00Z',
        parent_email: 'parent@example.com',
        parent_name: 'Jane Doe',
        consent_given: false,
      };

      const result = studentConsentSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should reject invalid email', () => {
      const invalidData = {
        student_name: 'John Doe',
        birth_date: '2010-05-15T00:00:00Z',
        parent_email: 'not-an-email',
        parent_name: 'Jane Doe',
        consent_given: true,
      };

      const result = studentConsentSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should enforce name length limits', () => {
      const tooLongName = {
        student_name: 'A'.repeat(101),
        birth_date: '2010-05-15T00:00:00Z',
        parent_email: 'parent@example.com',
        parent_name: 'Jane Doe',
        consent_given: true,
      };

      const result = studentConsentSchema.safeParse(tooLongName);
      expect(result.success).toBe(false);
    });
  });

  describe('rateLimitSchema', () => {
    it('should validate with custom values', () => {
      const customData = {
        windowMs: 30 * 60 * 1000, // 30 minutes
        max: 50,
        message: 'Custom rate limit message',
      };

      const result = rateLimitSchema.safeParse(customData);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(customData);
    });

    it('should apply default values', () => {
      const emptyData = {};

      const result = rateLimitSchema.safeParse(emptyData);
      expect(result.success).toBe(true);
      expect(result.data?.windowMs).toBe(15 * 60 * 1000);
      expect(result.data?.max).toBe(100);
      expect(result.data?.message).toBe('Too many requests from this IP');
    });
  });

  describe('validateEmail', () => {
    it('should validate correct email formats', () => {
      const validEmails = [
        'user@example.com',
        'teacher@school.edu',
        'admin+tag@university.org',
        'first.last@company.co.uk',
        'user123@subdomain.example.com',
      ];

      validEmails.forEach(email => {
        expect(validateEmail(email)).toBe(true);
      });
    });

    it('should reject invalid email formats', () => {
      const invalidEmails = [
        'notanemail',
        '@example.com',
        'user@',
        'user @example.com',
        'user@example',
        'user@.com',
        'user..name@example.com',
        '',
      ];

      invalidEmails.forEach(email => {
        expect(validateEmail(email)).toBe(false);
      });
    });
  });

  describe('validateSchoolDomain', () => {
    it('should extract domain from valid school emails', () => {
      expect(validateSchoolDomain('teacher@school.edu')).toBe('school.edu');
      expect(validateSchoolDomain('admin@university.org')).toBe('university.org');
      expect(validateSchoolDomain('user@academy.k12.ca.us')).toBe('academy.k12.ca.us');
    });

    it('should reject personal email domains', () => {
      const personalEmails = [
        'user@gmail.com',
        'teacher@yahoo.com',
        'admin@hotmail.com',
        'student@outlook.com',
      ];

      personalEmails.forEach(email => {
        expect(validateSchoolDomain(email)).toBeNull();
      });
    });

    it('should handle case-insensitive personal domains', () => {
      expect(validateSchoolDomain('user@GMAIL.COM')).toBeNull();
      expect(validateSchoolDomain('user@Gmail.Com')).toBeNull();
    });

    it('should return null for invalid emails', () => {
      expect(validateSchoolDomain('notanemail')).toBeNull();
      expect(validateSchoolDomain('@example.com')).toBeNull();
      expect(validateSchoolDomain('')).toBeNull();
    });
  });

  describe('schema integration', () => {
    it('should handle complex validation scenarios', () => {
      // Test that schemas can be composed
      const sessionWithConsent = z.object({
        session: createSessionSchema,
        consent: studentConsentSchema,
      });

      const complexData = {
        session: {
          topic: 'Math Class',
        },
        consent: {
          student_name: 'John Doe',
          birth_date: '2015-01-01T00:00:00Z',
          parent_email: 'parent@school.edu',
          parent_name: 'Jane Doe',
          consent_given: true,
        },
      };

      const result = sessionWithConsent.safeParse(complexData);
      expect(result.success).toBe(true);
    });
  });
});
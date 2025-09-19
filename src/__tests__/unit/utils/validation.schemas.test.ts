import { z } from 'zod';
import {
  googleAuthSchema,
  refreshTokenSchema,
  createSessionSchema,
  createStudentSchema,
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
      // Note: autoGroupEnabled, maxStudents, and targetGroupSize properties have been removed from the schema
      expect(result.data?.topic).toBeDefined();
      expect(result.data?.subject).toBeDefined();
      expect(result.data?.plannedDuration).toBeDefined();
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

  describe('createStudentSchema', () => {
    it('should validate basic student data', () => {
      const validData = {
        firstName: 'John',
        lastName: 'Doe',
        gradeLevel: '5th',
      };

      const result = createStudentSchema.safeParse(validData);
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject(validData);
      expect(result.data?.dataConsentGiven).toBe(false); // default
      expect(result.data?.audioConsentGiven).toBe(false); // default
    });

    it('should validate student who is 13 or older (no consent needed)', () => {
      const validData = {
        firstName: 'Jane',
        lastName: 'Smith',
        gradeLevel: '8th',
        isUnderConsentAge: false,
      };

      const result = createStudentSchema.safeParse(validData);
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject(validData);
    });

    it('should validate under-13 student with parental consent', () => {
      const validData = {
        firstName: 'Young',
        lastName: 'Student',
        gradeLevel: '2nd',
        isUnderConsentAge: true,
        hasParentalConsent: true,
        parentEmail: 'parent@example.com',
      };

      const result = createStudentSchema.safeParse(validData);
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject(validData);
    });

    it('should validate under-13 student without consent (but will be rejected by business logic)', () => {
      // Schema validation passes, but business logic in controller should reject
      const validData = {
        firstName: 'Another',
        lastName: 'Young',
        gradeLevel: '1st',
        isUnderConsentAge: true,
        hasParentalConsent: false,
      };

      const result = createStudentSchema.safeParse(validData);
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject(validData);
    });

    it('should enforce first name length limits', () => {
      const tooLongFirstName = {
        firstName: 'A'.repeat(51), // Over 50 character limit
        lastName: 'Doe',
      };

      const result = createStudentSchema.safeParse(tooLongFirstName);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe('First name must be 50 characters or less');
      }
    });

    it('should enforce last name length limits', () => {
      const tooLongLastName = {
        firstName: 'John',
        lastName: 'B'.repeat(51), // Over 50 character limit
      };

      const result = createStudentSchema.safeParse(tooLongLastName);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe('Last name must be 50 characters or less');
      }
    });

    it('should reject empty first name', () => {
      const invalidData = {
        firstName: '',
        lastName: 'Doe',
      };

      const result = createStudentSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject empty last name', () => {
      const invalidData = {
        firstName: 'John',
        lastName: '',
      };

      const result = createStudentSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject invalid parent email format', () => {
      const invalidData = {
        firstName: 'John',
        lastName: 'Doe',
        parentEmail: 'not-an-email',
      };

      const result = createStudentSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe('Invalid parent email format');
      }
    });

    it('should validate with all optional fields included', () => {
      const completeData = {
        firstName: 'Complete',
        lastName: 'Student',
        gradeLevel: '4th',
        parentEmail: 'parent@school.edu',
        isUnderConsentAge: true,
        hasParentalConsent: true,
        dataConsentGiven: true,
        audioConsentGiven: true,
      };

      const result = createStudentSchema.safeParse(completeData);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(completeData);
    });

    it('should enforce grade level length limits', () => {
      const tooLongGrade = {
        firstName: 'John',
        lastName: 'Doe',
        gradeLevel: 'A'.repeat(21), // Over 20 character limit
      };

      const result = createStudentSchema.safeParse(tooLongGrade);
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
      const sessionWithStudent = z.object({
        session: createSessionSchema,
        student: createStudentSchema,
      });

      const complexData = {
        session: {
          topic: 'Math Class',
          subject: 'Mathematics',
          groupPlan: {
            numberOfGroups: 3,
            groupSize: 4,
            groups: [
              {
                name: 'Group 1',
                memberIds: ['student1', 'student2', 'student3', 'student4'],
              },
              {
                name: 'Group 2', 
                memberIds: ['student5', 'student6', 'student7', 'student8'],
              },
              {
                name: 'Group 3',
                memberIds: ['student9', 'student10', 'student11', 'student12'],
              },
            ],
          },
        },
        student: {
          firstName: 'John',
          lastName: 'Doe',
          gradeLevel: '5th',
          isUnderConsentAge: false,
        },
      };

      const result = sessionWithStudent.safeParse(complexData);
      expect(result.success).toBe(true);
    });
  });
});
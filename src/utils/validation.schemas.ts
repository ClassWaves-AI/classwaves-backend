import { z } from 'zod';

// Auth schemas
export const googleAuthSchema = z.object({
  code: z.string().min(1, 'Authorization code is required').optional(),
  credential: z.string().min(1, 'Google credential is required').optional(),
  codeVerifier: z.string().min(43).max(256).optional(),
  state: z.string().optional(),
}).refine((data) => data.code || data.credential, {
  message: 'Either code or credential must be provided',
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const generateTestTokenSchema = z.object({
  secretKey: z.string().min(1, 'Secret key is required'),
  teacherId: z.string().optional(),
  schoolId: z.string().optional(),
  role: z.enum(['teacher', 'admin', 'super_admin']).default('teacher'),
  permissions: z.array(z.string()).default([]),
});

// Session schemas (updated for declarative workflow)
export const createSessionSchema = z.object({
  topic: z.string().min(1).max(200),
  goal: z.string().max(500).optional(),
  subject: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  scheduledStart: z.string()
    .transform(val => val === "" ? undefined : val)
    .optional()
    .refine((val) => {
      if (!val) return true; // Allow undefined or empty
      // Require ISO 8601 format with time component
      const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})$/;
      return iso8601Regex.test(val) && !isNaN(Date.parse(val));
    }, {
      message: "Invalid datetime string - must be ISO 8601 format",
    }),
  plannedDuration: z.number().min(5).max(480).default(45),
  groupPlan: z.object({
    numberOfGroups: z.number().min(1).max(20),
    groupSize: z.number().min(2).max(10),
    groups: z.array(z.object({
      name: z.string().min(1).max(50),
      leaderId: z.string().optional(),
      memberIds: z.array(z.string()),
    })),
  }),
  aiConfig: z.object({
    hidden: z.boolean().default(true),
    defaultsApplied: z.boolean().default(true),
  }).optional(),
});

// Student schemas
export const studentConsentSchema = z.object({
  student_name: z.string().min(1).max(100),
  birth_date: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: "Invalid datetime string",
  }),
  parent_email: z.string().email(),
  parent_name: z.string().min(1).max(100),
  consent_given: z.boolean(),
  consent_timestamp: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: "Invalid datetime string",
  }).optional(),
});

// Admin schemas
export const createSchoolSchema = z.object({
  name: z.string().min(1).max(200, 'School name must be 200 characters or less'),
  domain: z.string().min(3).max(100, 'Domain must be between 3 and 100 characters')
    .refine((domain) => {
      // Basic domain validation
      const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
      return domainRegex.test(domain);
    }, {
      message: 'Invalid domain format',
    }),
  adminEmail: z.string().email('Invalid email format'),
  subscriptionTier: z.enum(['basic', 'pro', 'enterprise']).default('basic'),
  subscriptionStatus: z.enum(['active', 'trial', 'expired', 'suspended']).default('trial'),
  maxTeachers: z.number().int().min(1).max(1000).default(10),
  ferpaAgreement: z.boolean().default(false),
  coppaCompliant: z.boolean().default(false),
  dataRetentionDays: z.number().int().min(1).max(3650).default(2555), // 7 years default
});

export const updateSchoolSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  adminEmail: z.string().email().optional(),
  subscriptionTier: z.enum(['basic', 'pro', 'enterprise']).optional(),
  subscriptionStatus: z.enum(['active', 'trial', 'expired', 'suspended']).optional(),
  maxTeachers: z.number().int().min(1).max(1000).optional(),
  ferpaAgreement: z.boolean().optional(),
  coppaCompliant: z.boolean().optional(),
  dataRetentionDays: z.number().int().min(1).max(3650).optional(),
});

export const updateTeacherSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.enum(['teacher', 'admin', 'super_admin']).optional(),
  status: z.enum(['pending', 'active', 'suspended', 'deactivated']).optional(),
  accessLevel: z.string().min(1).max(50).optional(),
  maxConcurrentSessions: z.number().int().min(1).max(100).optional(),
  grade: z.string().max(50).optional(),
  subject: z.string().max(100).optional(),
  timezone: z.string().min(1).max(50).optional(),
});

// Roster schemas
export const createStudentSchema = z.object({
  firstName: z.string().min(1).max(50, 'First name must be 50 characters or less'),
  lastName: z.string().min(1).max(50, 'Last name must be 50 characters or less'),
  gradeLevel: z.string().max(20).optional(),
  parentEmail: z.string().email('Invalid parent email format').optional(),
  isUnderConsentAge: z.boolean().optional(), // Is student under 13?
  hasParentalConsent: z.boolean().optional(), // If under 13, has consent been obtained?
  dataConsentGiven: z.boolean().default(false),
  audioConsentGiven: z.boolean().default(false),
});

export const updateStudentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  gradeLevel: z.string().max(20).optional(),
  parentEmail: z.string().email().optional(),
  status: z.enum(['active', 'inactive', 'deactivated']).optional(),
  dataConsentGiven: z.boolean().optional(),
  audioConsentGiven: z.boolean().optional(),
});

export const ageVerificationSchema = z.object({
  birthDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: 'Invalid birth date format',
  }),
  parentEmail: z.string().email('Invalid parent email format').optional(),
});

// Note: Group schemas removed - groups are configured declaratively at session creation

// Kiosk schemas
export const updateGroupStatusSchema = z.object({
    isReady: z.boolean(),
});

// Security schemas
export const rateLimitSchema = z.object({
  windowMs: z.number().default(15 * 60 * 1000), // 15 minutes
  max: z.number().default(100), // limit each IP to 100 requests per windowMs
  message: z.string().default('Too many requests from this IP'),
});

// Common validation functions
export function validateEmail(email: string): boolean {
  // Additional checks first
  if (!email || email.length === 0) return false;
  if (email.includes(' ')) return false; // No spaces allowed
  if (email.includes('..')) return false; // No consecutive dots
  if (email.startsWith('.') || email.endsWith('.')) return false;
  if (!email.includes('@')) return false;
  
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  if (parts[0].length === 0 || parts[1].length === 0) return false;
  
  // Check domain has at least one dot
  const domain = parts[1];
  if (!domain.includes('.')) return false;
  if (domain.startsWith('.')) return false;
  
  // More comprehensive email validation regex
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  
  return emailRegex.test(email);
}

export function validateSchoolDomain(email: string): string | null {
  if (!validateEmail(email)) return null;
  const domain = email.split('@')[1];
  // Check if it's a valid educational domain (not personal email)
  const personalDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com'];
  if (personalDomains.includes(domain.toLowerCase())) return null;
  return domain;
}
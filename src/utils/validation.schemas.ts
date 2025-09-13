import { z } from 'zod';

// Auth schemas
export const googleAuthSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  state: z.string().optional(),
}).passthrough();

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
export const createSessionSchema = z.preprocess((input) => {
  if (input && typeof input === 'object') {
    const obj: any = { ...(input as any) };
    if (!('subject' in obj)) {
      const keys = Object.keys(obj);
      // If only topic is provided (minimal input), supply a default subject
      if (keys.length === 1 && keys[0] === 'topic') {
        obj.subject = 'General';
      }
    }
    return obj;
  }
  return input;
}, z.object({
  topic: z.string().min(1).max(200),
  goal: z.string().max(500).optional(),
  subject: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  scheduledStart: z.string()
    .transform(val => val === "" ? undefined : val)
    .optional()
    .refine((val) => {
      if (!val) return true; // Allow undefined or empty
      const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})$/;
      return iso8601Regex.test(val) && !isNaN(Date.parse(val));
    }, {
      message: "Invalid datetime string - must be ISO 8601 format",
    }),
  plannedDuration: z.number().min(5).max(480).default(45),
  // Legacy-compatible optional fields validated when present
  maxStudents: z.number().int().min(1).max(100).optional(),
  targetGroupSize: z.number().int().min(2).max(10).optional(),
  autoGroupEnabled: z.boolean().optional(),
  settings: z.object({
    recordingEnabled: z.boolean().optional(),
    transcriptionEnabled: z.boolean().optional(),
    aiAnalysisEnabled: z.boolean().optional(),
  }).optional(),
  // Declarative group plan is optional for backward compatibility
  groupPlan: z.object({
    numberOfGroups: z.number().min(1).max(20),
    groupSize: z.number().min(2).max(10),
    groups: z.array(z.object({
      name: z.string().min(1).max(50),
      leaderId: z.string().optional(),
      memberIds: z.array(z.string()),
    })),
  }).optional(),
  aiConfig: z.object({
    hidden: z.boolean().default(true),
    defaultsApplied: z.boolean().default(true),
  }).optional(),
  emailNotifications: z.object({
    enabled: z.boolean(),
  }).optional(),
}).passthrough());

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
  firstName: z.string().min(1).max(50).optional(),
  lastName: z.string().min(1).max(50).optional(),
  preferredName: z.string().min(1).max(50).optional(),
  email: z.string().email().optional(),
  gradeLevel: z.string().max(20).optional(),
  parentEmail: z.string().email().optional(),
  status: z.enum(['active', 'inactive', 'deactivated']).optional(),
  dataConsentGiven: z.boolean().optional(),
  audioConsentGiven: z.boolean().optional(),
}).passthrough();

export const inviteTeacherSchema = z.object({
  email: z.string().email('Invalid email format'),
  role: z.enum(['teacher', 'admin']).default('teacher'),
  schoolId: z.string().uuid().optional(),
});

export const acceptInviteSchema = z.object({
  token: z.string().uuid('Invalid invite token'),
  name: z.string().min(1).max(100),
  password: z.string().min(8).max(128).optional(),
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

// WebSocket audio payload at the edge (sessions namespace)
export const AudioChunkPayloadSchema = z.object({
  groupId: z.string().min(1, 'groupId is required'),
  // Accept unknown at the edge; coercion happens in adapter
  audioData: z.any(),
  mimeType: z.string().min(1, 'mimeType is required'),
});

// WebSocket: session join payload
export const SessionJoinPayloadSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required').or(z.string().min(1).transform((v) => v)),
}).passthrough();

// WebSocket: session status update payload (notify-only)
export const SessionStatusUpdateSchema = z.object({
  sessionId: z.string().min(1),
  status: z.enum(['active', 'paused', 'ended']),
  teacher_notes: z.string().max(1000).optional(),
}).passthrough();

// WebSocket: group status update payload
export const GroupStatusUpdateSchema = z.object({
  groupId: z.string().min(1),
  sessionId: z.string().min(1),
  status: z.enum(['connected', 'ready', 'active', 'paused', 'issue', 'waiting']).optional(),
  isReady: z.boolean().optional(),
  issueReason: z.string().max(200).optional(),
}).passthrough();

// WebSocket: group join/leave payload
export const GroupJoinLeaveSchema = z.object({
  groupId: z.string().min(1),
  sessionId: z.string().min(1),
}).passthrough();

// WebSocket: group leader ready payload
export const GroupLeaderReadySchema = z.object({
  groupId: z.string().min(1),
  sessionId: z.string().min(1),
  ready: z.boolean(),
}).passthrough();

// WebSocket: WaveListener issue payload
export const WaveListenerIssueSchema = z.object({
  groupId: z.string().min(1),
  sessionId: z.string().min(1),
  reason: z.enum(['device_error', 'permission_denied', 'network_issue', 'low_bandwidth', 'unknown']),
}).passthrough();

// WebSocket: audio stream lifecycle (start/stop)
export const AudioStreamLifecycleSchema = z.object({
  groupId: z.string().min(1),
}).passthrough();

// Security schemas
export const rateLimitSchema = z.object({
  windowMs: z.number().default(15 * 60 * 1000), // 15 minutes
  max: z.number().default(100), // limit each IP to 100 requests per windowMs
  message: z.string().default('Too many requests from this IP'),
});

// Districts schemas (admin only)
export const createDistrictSchema = z.object({
  name: z.string().min(1).max(200),
  state: z.string().min(2).max(50),
  region: z.string().max(100).optional(),
  superintendentName: z.string().max(100).optional(),
  contactEmail: z.string().email('Invalid email format').optional(),
  contactPhone: z.string().max(30).optional(),
  website: z.string().url('Invalid URL').optional(),
  subscriptionTier: z.enum(['basic', 'pro', 'enterprise']).default('basic').optional(),
  isActive: z.boolean().default(true).optional(),
});

export const updateDistrictSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  state: z.string().min(2).max(50).optional(),
  region: z.string().max(100).optional(),
  superintendentName: z.string().max(100).optional(),
  contactEmail: z.string().email('Invalid email format').optional(),
  contactPhone: z.string().max(30).optional(),
  website: z.string().url('Invalid URL').optional(),
  subscriptionTier: z.enum(['basic', 'pro', 'enterprise']).optional(),
  isActive: z.boolean().optional(),
}).refine((obj) => Object.keys(obj).length > 0, { message: 'At least one field must be provided for update' });

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
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  
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

// -----------------------------
// Phase 3: REST-edge add-ons
// -----------------------------

// PUT /api/v1/sessions/:sessionId body
export const updateSessionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  status: z.enum(['created', 'active', 'paused', 'ended', 'archived']).optional(),
  target_group_size: z.number().int().min(2).max(10).optional(),
  auto_group_enabled: z.boolean().optional(),
  scheduled_start: z.string()
    .optional()
    .refine((val) => {
      if (!val) return true;
      const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})$/;
      return iso8601Regex.test(val) && !isNaN(Date.parse(val));
    }, { message: 'Invalid datetime string - must be ISO 8601 format' }),
  planned_duration_minutes: z.number().int().min(5).max(480).optional(),
}).refine((obj) => Object.keys(obj).length > 0, {
  message: 'At least one field must be provided for update',
});

// GET /api/v1/transcripts query
export const transcriptsQuerySchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  groupId: z.string().min(1, 'groupId is required'),
  since: z.coerce.number().int().min(0).optional(),
  until: z.coerce.number().int().min(0).optional(),
}).refine((o) => (o.since == null || o.until == null || o.since <= o.until), {
  message: 'since must be less than or equal to until',
  path: ['since'],
});

// Session lifecycle bodies with optional notes
export const sessionLifecycleNotesSchema = z.object({
  teacher_notes: z.string().max(1000).optional(),
});

// POST /:sessionId/resend-email body
export const resendSessionEmailSchema = z.object({
  groupId: z.string().min(1, 'groupId is required'),
  newLeaderId: z.string().min(1).optional(),
  reason: z.enum(['resend', 'leader_change']).default('resend'),
}).refine((o) => (o.reason !== 'leader_change' || !!o.newLeaderId), {
  message: 'newLeaderId is required when reason is leader_change',
  path: ['newLeaderId'],
});

// Analytics monitoring routes
export const analyticsLogsQuerySchema = z.object({
  operation: z.string().optional(),
  table: z.string().optional(),
  sessionId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100).optional(),
  since: z.string().optional().refine((val) => !val || !isNaN(Date.parse(val)), {
    message: 'since must be a valid ISO date/time string',
  }),
});

export const analyticsSampleRateSchema = z.object({
  sampleRate: z.number().min(0).max(1),
});

export const analyticsCleanupSchema = z.object({
  olderThanHours: z.number().int().min(1).max(720).default(24).optional(),
});

export const analyticsCacheSyncSchema = z.object({
  force: z.boolean().default(false).optional(),
});

export const analyticsCostAnalysisQuerySchema = z.object({
  timeframeHours: z.coerce.number().int().min(1).max(168).default(24).optional(),
});

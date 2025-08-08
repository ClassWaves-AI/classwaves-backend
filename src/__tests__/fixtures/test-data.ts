import { v4 as uuidv4 } from 'uuid';

// Test data factories
export const testData = {
  // School test data
  schools: {
    active: {
      id: 'school-active-123',
      name: 'Active Test School',
      domain: 'activeschool.edu',
      admin_email: 'admin@activeschool.edu',
      subscription_tier: 'pro' as const,
      subscription_status: 'active' as const,
      max_teachers: 100,
      current_teachers: 25,
      student_count: 500,
      teacher_count: 25,
      subscription_end_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      ferpa_agreement: true,
      coppa_compliant: true,
      data_retention_days: 180,
      created_at: new Date('2024-01-01'),
      updated_at: new Date(),
    },
    trial: {
      id: 'school-trial-456',
      name: 'Trial Test School',
      domain: 'trialschool.edu',
      admin_email: 'admin@trialschool.edu',
      subscription_tier: 'basic' as const,
      subscription_status: 'trial' as const,
      max_teachers: 10,
      current_teachers: 3,
      student_count: 100,
      teacher_count: 5,
      trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      subscription_end_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      ferpa_agreement: true,
      coppa_compliant: true,
      data_retention_days: 90,
      created_at: new Date('2024-03-01'),
      updated_at: new Date(),
    },
    expired: {
      id: 'school-expired-789',
      name: 'Expired Test School',
      domain: 'expiredschool.edu',
      admin_email: 'admin@expiredschool.edu',
      subscription_tier: 'basic' as const,
      subscription_status: 'expired' as const,
      max_teachers: 10,
      current_teachers: 5,
      student_count: 150,
      teacher_count: 8,
      subscription_end_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      ferpa_agreement: true,
      coppa_compliant: true,
      data_retention_days: 90,
      created_at: new Date('2023-01-01'),
      updated_at: new Date(),
    },
  },

  // Teacher test data
  teachers: {
    active: {
      id: 'teacher-active-123',
      google_id: 'google-teacher-123',
      email: 'teacher@activeschool.edu',
      name: 'Active Teacher',
      picture: 'https://example.com/teacher.jpg',
      school_id: 'school-active-123',
      role: 'teacher' as const,
      status: 'active' as const,
      access_level: 'standard',
      max_concurrent_sessions: 3,
      current_sessions: 1,
      grade: '5th',
      subject: 'Math',
      timezone: 'America/New_York',
      login_count: 42,
      total_sessions_created: 15,
      last_login: new Date(),
      created_at: new Date('2024-01-15'),
      updated_at: new Date(),
    },
    admin: {
      id: 'teacher-admin-456',
      google_id: 'google-admin-456',
      email: 'admin@activeschool.edu',
      name: 'School Admin',
      picture: 'https://example.com/admin.jpg',
      school_id: 'school-active-123',
      role: 'admin' as const,
      status: 'active' as const,
      access_level: 'admin',
      max_concurrent_sessions: 5,
      current_sessions: 0,
      timezone: 'America/New_York',
      login_count: 156,
      total_sessions_created: 50,
      last_login: new Date(),
      created_at: new Date('2024-01-01'),
      updated_at: new Date(),
    },
    suspended: {
      id: 'teacher-suspended-789',
      google_id: 'google-suspended-789',
      email: 'suspended@activeschool.edu',
      name: 'Suspended Teacher',
      school_id: 'school-active-123',
      role: 'teacher' as const,
      status: 'suspended' as const,
      access_level: 'none',
      max_concurrent_sessions: 0,
      current_sessions: 0,
      timezone: 'America/New_York',
      login_count: 5,
      total_sessions_created: 2,
      created_at: new Date('2024-02-01'),
      updated_at: new Date(),
    },
  },

  // Session test data
  sessions: {
    created: {
      id: 'session-created-123',
      teacher_id: 'teacher-active-123',
      school_id: 'school-active-123',
      name: 'Math Class - Period 1',
      description: 'Introduction to fractions',
      status: 'created' as const,
      session_type: 'live' as const,
      subject: 'Math',
      grade_level: '5th',
      max_students: 30,
      current_students: 0,
      created_at: new Date(),
      updated_at: new Date(),
    },
    active: {
      id: 'session-active-456',
      teacher_id: 'teacher-active-123',
      school_id: 'school-active-123',
      name: 'Science Lab - Period 3',
      description: 'Chemistry experiments',
      status: 'active' as const,
      session_type: 'live' as const,
      subject: 'Science',
      grade_level: '8th',
      max_students: 24,
      current_students: 18,
      start_time: new Date(Date.now() - 15 * 60 * 1000),
      created_at: new Date(Date.now() - 30 * 60 * 1000),
      updated_at: new Date(),
    },
    paused: {
      id: 'session-paused-789',
      teacher_id: 'teacher-active-123',
      school_id: 'school-active-123',
      name: 'English Literature',
      description: 'Reading comprehension',
      status: 'paused' as const,
      session_type: 'live' as const,
      subject: 'English',
      grade_level: '7th',
      max_students: 25,
      current_students: 20,
      start_time: new Date(Date.now() - 45 * 60 * 1000),
      pause_time: new Date(Date.now() - 5 * 60 * 1000),
      created_at: new Date(Date.now() - 60 * 60 * 1000),
      updated_at: new Date(),
    },
    ended: {
      id: 'session-ended-999',
      teacher_id: 'teacher-active-123',
      school_id: 'school-active-123',
      name: 'History Class',
      description: 'American Revolution',
      status: 'ended' as const,
      session_type: 'live' as const,
      subject: 'History',
      grade_level: '8th',
      max_students: 30,
      current_students: 0,
      start_time: new Date(Date.now() - 90 * 60 * 1000),
      end_time: new Date(Date.now() - 30 * 60 * 1000),
      duration_minutes: 60,
      created_at: new Date(Date.now() - 120 * 60 * 1000),
      updated_at: new Date(Date.now() - 30 * 60 * 1000),
    },
  },

  // Student test data
  students: {
    active: [
      {
        id: 'student-1',
        display_name: 'Student One',
        session_id: 'session-active-456',
        group_id: 'group-123',
        avatar: 'avatar1',
        status: 'active' as const,
        joined_at: new Date(Date.now() - 10 * 60 * 1000),
      },
      {
        id: 'student-2',
        display_name: 'Student Two',
        session_id: 'session-active-456',
        group_id: 'group-123',
        avatar: 'avatar2',
        status: 'active' as const,
        joined_at: new Date(Date.now() - 8 * 60 * 1000),
      },
    ],
  },

  // Group test data
  groups: {
    active: [
      {
        id: 'group-123',
        session_id: 'session-active-456',
        name: 'Group 1',
        max_size: 4,
        current_size: 2,
        created_at: new Date(Date.now() - 20 * 60 * 1000),
      },
      {
        id: 'group-456',
        session_id: 'session-active-456',
        name: 'Group 2',
        max_size: 4,
        current_size: 0,
        created_at: new Date(Date.now() - 20 * 60 * 1000),
      },
    ],
  },

  // JWT tokens
  tokens: {
    validAccessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.access',
    validRefreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.refresh',
    expiredToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.expired',
    invalidToken: 'invalid.token.here',
  },

  // Request bodies
  requests: {
    googleAuth: {
      code: 'valid-google-auth-code',
    },
    refreshToken: {
      refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.refresh',
    },
    createSession: {
      topic: 'Math - Fractions Unit',
      goal: 'Students will understand fraction operations',
      description: 'Interactive session on fraction addition and subtraction',
      maxStudents: 30,
      targetGroupSize: 4,
      plannedDuration: 45,
      autoGroupEnabled: true,
      settings: {
        recordingEnabled: true,
        transcriptionEnabled: true,
        aiAnalysisEnabled: true,
      },
    },
    joinSession: {
      sessionCode: 'ABC123',
      displayName: 'Test Student',
      avatar: 'avatar1',
    },
    createGroup: {
      name: 'New Group',
      maxSize: 4,
    },
  },
};

// Helper functions
export const generateTestId = (prefix: string) => `${prefix}-${uuidv4()}`;

export const createTestDate = (daysFromNow: number) => {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date;
};

export const createAuthHeader = (token: string) => ({
  authorization: `Bearer ${token}`,
});

export const createTestUser = (overrides = {}) => ({
  ...testData.teachers.active,
  id: generateTestId('teacher'),
  ...overrides,
});

export const createTestSchool = (overrides = {}) => ({
  ...testData.schools.active,
  id: generateTestId('school'),
  ...overrides,
});

export const createTestSession = (overrides = {}) => ({
  ...testData.sessions.created,
  id: generateTestId('session'),
  ...overrides,
});
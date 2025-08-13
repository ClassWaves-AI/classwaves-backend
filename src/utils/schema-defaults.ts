/**
 * Schema-aware default values based on actual Databricks table schemas
 */

export const classroomSessionDefaults = {
  // Core session info
  status: 'created',
  scheduled_start: new Date(),
  actual_start: new Date(),
  actual_end: new Date(),
  planned_duration_minutes: 60,
  actual_duration_minutes: 0,
  
  // Student and group settings (declarative mode)
  target_group_size: 4,
  auto_group_enabled: false, // Always disabled - groups are pre-configured
  
  // Feature flags
  recording_enabled: false,
  transcription_enabled: true,
  ai_analysis_enabled: true,
  
  // Compliance
  ferpa_compliant: true,
  coppa_compliant: true,
  recording_consent_obtained: false,
  data_retention_date: new Date(Date.now() + 7 * 365 * 24 * 60 * 60 * 1000), // 7 years
  
  // Analytics (initial values)
  total_groups: 0,
  total_students: 0,
  engagement_score: 0.0,
  
  // Audit fields
  created_at: new Date(),
  updated_at: new Date(),
  
  // Session management
  access_code: '',
  end_reason: '',
  teacher_notes: ''
};

export const studentGroupDefaults = {
  status: 'waiting',
  current_size: 0,
  student_ids: '[]',
  auto_managed: false, // Always false - groups are pre-configured
  start_time: new Date(),
  end_time: new Date(),
  total_speaking_time_seconds: 0,
  collaboration_score: 0.0,
  topic_focus_score: 0.0,
  is_ready: false,
  leader_id: null,
  created_at: new Date(),
  updated_at: new Date()
};

export const studentDefaults = {
  email: '',
  google_id: '',
  status: 'active',
  grade_level: '',
  has_parental_consent: false,
  consent_date: new Date(),
  parent_email: '',
  data_sharing_consent: false,
  audio_recording_consent: false,
  created_at: new Date(),
  updated_at: new Date()
};

export const auditLogDefaults = {
  event_timestamp: new Date(),
  event_category: 'system',
  session_id: '',
  resource_type: '',
  resource_id: '',
  description: '',
  ip_address: '127.0.0.1',
  user_agent: 'ClassWaves-Backend',
  compliance_basis: 'legitimate_educational_interest',
  data_accessed: '',
  affected_student_ids: '',
  created_at: new Date()
};

/**
 * Helper function to create a classroom session with all required fields
 */
export function createClassroomSessionData(overrides: Partial<any> = {}) {
  return {
    ...classroomSessionDefaults,
    ...overrides,
    // Ensure timestamps are always fresh if not overridden
    created_at: overrides.created_at || new Date(),
    updated_at: overrides.updated_at || new Date(),
    scheduled_start: overrides.scheduled_start || new Date(),
    actual_start: overrides.actual_start || new Date(),
    actual_end: overrides.actual_end || new Date(),
  };
}

/**
 * Helper function to create a student group with all required fields
 */
export function createStudentGroupData(overrides: Partial<any> = {}) {
  return {
    ...studentGroupDefaults,
    ...overrides,
    created_at: overrides.created_at || new Date(),
    updated_at: overrides.updated_at || new Date(),
    start_time: overrides.start_time || new Date(),
    end_time: overrides.end_time || new Date(),
  };
}

/**
 * Helper function to create audit log entry with all required fields
 */
export function createAuditLogData(overrides: Partial<any> = {}) {
  return {
    ...auditLogDefaults,
    ...overrides,
    event_timestamp: overrides.event_timestamp || new Date(),
    created_at: overrides.created_at || new Date(),
  };
}

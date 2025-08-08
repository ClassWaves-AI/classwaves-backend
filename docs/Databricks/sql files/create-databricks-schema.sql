-- ClassWaves Databricks Schema Creation Script
-- This script creates all necessary tables for the ClassWaves platform
-- with FERPA and COPPA compliance built-in

-- =====================================================
-- CATALOG AND SCHEMA SETUP
-- =====================================================

-- Create the catalog if it doesn't exist
CREATE CATALOG IF NOT EXISTS classwaves;

-- Use the catalog
USE CATALOG classwaves;

-- Create the main schema
CREATE SCHEMA IF NOT EXISTS main;

-- Use the schema
USE SCHEMA main;

-- =====================================================
-- PHASE 1: FOUNDATION TABLES
-- =====================================================

-- Schools and Authentication
CREATE TABLE IF NOT EXISTS schools (
  id STRING NOT NULL,
  name STRING NOT NULL,
  domain STRING NOT NULL, -- Google Workspace domain
  
  -- Google Workspace Integration
  google_workspace_id STRING,
  admin_email STRING NOT NULL,
  
  -- Subscription Management  
  subscription_tier STRING NOT NULL DEFAULT 'free', -- free, basic, professional, enterprise
  subscription_status STRING NOT NULL DEFAULT 'trial', -- trial, active, suspended, cancelled, expired
  max_teachers INT NOT NULL DEFAULT 5,
  current_teachers INT NOT NULL DEFAULT 0,
  
  -- Billing Information
  stripe_customer_id STRING,
  subscription_start_date TIMESTAMP,
  subscription_end_date TIMESTAMP,
  trial_ends_at TIMESTAMP,
  
  -- Compliance Settings
  ferpa_agreement BOOLEAN NOT NULL DEFAULT false,
  coppa_compliant BOOLEAN NOT NULL DEFAULT false,
  data_retention_days INT NOT NULL DEFAULT 30,
  
  -- Audit Fields
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY(id)
) USING DELTA
PARTITIONED BY (subscription_tier)
TBLPROPERTIES (
  'delta.autoOptimize.optimizeWrite' = 'true',
  'delta.autoOptimize.autoCompact' = 'true'
);

-- Add unique constraint on domain
-- Note: Databricks doesn't support ALTER TABLE ADD CONSTRAINT directly
-- This is handled at application level

-- Data Retention Policies
CREATE TABLE IF NOT EXISTS data_retention_policies (
  id STRING NOT NULL,
  school_id STRING NOT NULL,
  
  -- Policy Details
  policy_name STRING NOT NULL,
  policy_type STRING NOT NULL, -- session_data, transcription_data, analytics_data, student_data
  retention_days INT NOT NULL,
  
  -- Compliance
  compliance_requirement STRING NOT NULL, -- ferpa, coppa, state_law, school_policy
  description STRING,
  
  -- Implementation
  automated_deletion BOOLEAN NOT NULL DEFAULT true,
  review_before_deletion BOOLEAN NOT NULL DEFAULT false,
  notification_required BOOLEAN NOT NULL DEFAULT false,
  
  -- Status
  policy_status STRING NOT NULL DEFAULT 'active', -- active, suspended, deprecated
  effective_date TIMESTAMP NOT NULL,
  expiration_date TIMESTAMP,
  
  -- Audit
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by STRING NOT NULL,
  
  PRIMARY KEY(id)
) USING DELTA;

-- =====================================================
-- PHASE 2: USER TABLES
-- =====================================================

-- Teachers
CREATE TABLE IF NOT EXISTS teachers (
  id STRING NOT NULL,
  
  -- Google Identity
  google_id STRING NOT NULL, -- Google user ID
  email STRING NOT NULL,
  name STRING NOT NULL,
  picture STRING,
  
  -- School Association
  school_id STRING NOT NULL,
  
  -- Authorization
  role STRING NOT NULL DEFAULT 'teacher', -- teacher, admin, super_admin
  status STRING NOT NULL DEFAULT 'active', -- pending, active, suspended, deactivated
  access_level STRING NOT NULL DEFAULT 'basic', -- basic, professional, enterprise
  
  -- Session Management
  max_concurrent_sessions INT NOT NULL DEFAULT 3,
  current_sessions INT NOT NULL DEFAULT 0,
  
  -- Profile Information
  grade STRING,
  subject STRING,
  timezone STRING NOT NULL DEFAULT 'UTC',
  
  -- Feature Flags (JSON)
  features_enabled STRING, -- JSON array of enabled features
  
  -- Activity Tracking
  last_login TIMESTAMP,
  login_count BIGINT NOT NULL DEFAULT 0,
  total_sessions_created BIGINT NOT NULL DEFAULT 0,
  
  -- Audit Fields
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY(id)
) USING DELTA
PARTITIONED BY (school_id)
TBLPROPERTIES (
  'delta.autoOptimize.optimizeWrite' = 'true',
  'delta.autoOptimize.autoCompact' = 'true'
);

-- Registered Students (COPPA Compliant)
CREATE TABLE IF NOT EXISTS registered_students (
  id STRING NOT NULL,
  
  -- Minimal Identity (COPPA)
  display_name STRING NOT NULL, -- First name only
  email STRING, -- Optional, only for 13+
  
  -- School Association
  school_id STRING NOT NULL,
  teacher_id STRING NOT NULL,
  
  -- Age Verification
  birth_year INT, -- Year only for privacy
  age_verified BOOLEAN NOT NULL DEFAULT false,
  is_under_13 BOOLEAN NOT NULL DEFAULT true,
  
  -- Parental Consent
  parent_email STRING,
  parental_consent_id STRING, -- Reference to consent record
  consent_status STRING NOT NULL DEFAULT 'pending', -- pending, granted, denied, revoked
  
  -- Account Status
  status STRING NOT NULL DEFAULT 'active', -- active, inactive, suspended
  
  -- Privacy Settings
  data_collection_allowed BOOLEAN NOT NULL DEFAULT false,
  analytics_allowed BOOLEAN NOT NULL DEFAULT false,
  
  -- Audit Fields
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY(id)
) USING DELTA
PARTITIONED BY (school_id)
TBLPROPERTIES (
  'delta.autoOptimize.optimizeWrite' = 'true',
  'delta.autoOptimize.autoCompact' = 'true'
);

-- =====================================================
-- PHASE 3: SESSION TABLES
-- =====================================================

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id STRING NOT NULL,
  
  -- Session Information
  title STRING NOT NULL,
  description STRING,
  status STRING NOT NULL DEFAULT 'created', -- created, active, paused, ended, archived
  
  -- Timing
  scheduled_start TIMESTAMP,
  actual_start TIMESTAMP,
  actual_end TIMESTAMP,
  planned_duration_minutes INT DEFAULT 45,
  actual_duration_minutes INT,
  
  -- Configuration
  max_students INT NOT NULL DEFAULT 30,
  target_group_size INT NOT NULL DEFAULT 4,
  auto_group_enabled BOOLEAN NOT NULL DEFAULT true,
  
  -- Ownership and School
  teacher_id STRING NOT NULL,
  school_id STRING NOT NULL,
  
  -- Session Settings
  recording_enabled BOOLEAN NOT NULL DEFAULT true,
  transcription_enabled BOOLEAN NOT NULL DEFAULT true,
  ai_analysis_enabled BOOLEAN NOT NULL DEFAULT true,
  
  -- Privacy and Compliance
  ferpa_compliant BOOLEAN NOT NULL DEFAULT true,
  coppa_compliant BOOLEAN NOT NULL DEFAULT true,
  recording_consent_obtained BOOLEAN NOT NULL DEFAULT false,
  data_retention_date TIMESTAMP,
  
  -- Metrics (calculated fields)
  total_groups INT DEFAULT 0,
  total_students INT DEFAULT 0,
  participation_rate DOUBLE DEFAULT 0.0,
  engagement_score DOUBLE DEFAULT 0.0,
  
  -- Additional metadata
  end_reason STRING, -- planned_completion, teacher_ended, technical_issue
  teacher_notes STRING,
  
  -- Audit Fields
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY(id)
) USING DELTA
PARTITIONED BY (school_id, date(created_at))
TBLPROPERTIES (
  'delta.autoOptimize.optimizeWrite' = 'true',
  'delta.autoOptimize.autoCompact' = 'true'
);

-- Groups
CREATE TABLE IF NOT EXISTS groups (
  id STRING NOT NULL,
  session_id STRING NOT NULL,
  
  -- Group Identity
  name STRING NOT NULL,
  group_number INT NOT NULL,
  
  -- Status
  status STRING NOT NULL DEFAULT 'waiting', -- waiting, active, paused, ended
  
  -- Configuration
  max_members INT NOT NULL DEFAULT 4,
  current_members INT NOT NULL DEFAULT 0,
  is_ready BOOLEAN NOT NULL DEFAULT false,
  
  -- Group Type
  is_leader_only_group BOOLEAN NOT NULL DEFAULT false,
  auto_assigned BOOLEAN NOT NULL DEFAULT true,
  
  -- Activity Metrics
  total_speaking_time_seconds DOUBLE DEFAULT 0.0,
  message_count INT DEFAULT 0,
  participation_balance_score DOUBLE DEFAULT 0.0,
  
  -- Audit Fields
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY(id)
) USING DELTA
PARTITIONED BY (session_id)
TBLPROPERTIES (
  'delta.autoOptimize.optimizeWrite' = 'true',
  'delta.autoOptimize.autoCompact' = 'true'
);

-- =====================================================
-- PHASE 4: PARTICIPANT TABLES
-- =====================================================

-- Student Participants (COPPA compliant - minimal data)
CREATE TABLE IF NOT EXISTS student_participants (
  id STRING NOT NULL,
  
  -- Session and Group Association
  session_id STRING NOT NULL,
  group_id STRING,
  
  -- Student Identity (minimal for COPPA)
  display_name STRING NOT NULL, -- First name or initials only
  join_token STRING NOT NULL, -- Unique token for session access
  
  -- Optional: Registered Student Reference
  registered_student_id STRING, -- If student has account
  
  -- Group Leadership
  is_leader BOOLEAN NOT NULL DEFAULT false,
  
  -- Participation Status
  is_ready BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_speaking BOOLEAN NOT NULL DEFAULT false,
  
  -- Activity Metrics
  join_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_activity TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total_speaking_time_seconds DOUBLE DEFAULT 0.0,
  message_count INT DEFAULT 0,
  engagement_score DOUBLE DEFAULT 0.0,
  
  -- COPPA Compliance
  age_verified BOOLEAN NOT NULL DEFAULT false,
  parental_consent BOOLEAN NOT NULL DEFAULT false,
  data_minimal BOOLEAN NOT NULL DEFAULT true,
  
  -- Auto-deletion for privacy
  auto_delete_at TIMESTAMP, -- Calculated based on retention policy
  
  PRIMARY KEY(id)
) USING DELTA
PARTITIONED BY (session_id, date(join_time))
TBLPROPERTIES (
  'delta.autoOptimize.optimizeWrite' = 'true',
  'delta.autoOptimize.autoCompact' = 'true',
  'delta.dataSkippingNumIndexedCols' = '3'
);

-- Parental Consent Records
CREATE TABLE IF NOT EXISTS parental_consent_records (
  id STRING NOT NULL,
  
  -- Student Information
  student_id STRING NOT NULL,
  student_display_name STRING NOT NULL,
  
  -- Parent Information
  parent_email STRING NOT NULL,
  parent_name STRING NOT NULL,
  parent_phone STRING,
  
  -- School Information
  school_id STRING NOT NULL,
  teacher_id STRING NOT NULL,
  
  -- Consent Details
  consent_type STRING NOT NULL, -- data_collection, audio_recording, ai_analysis, marketing
  consent_status STRING NOT NULL, -- pending, granted, denied, revoked
  consent_date TIMESTAMP,
  expiration_date TIMESTAMP,
  
  -- Consent Method
  consent_method STRING NOT NULL, -- email, form, verbal_recorded
  verification_code STRING,
  ip_address STRING,
  
  -- Consent Scope
  scope_details STRING, -- JSON with specific permissions
  limitations STRING, -- Any restrictions parent specified
  
  -- Document Storage
  consent_document_url STRING,
  document_hash STRING, -- For integrity verification
  
  -- Revocation
  revoked_date TIMESTAMP,
  revocation_reason STRING,
  
  -- Audit
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY(id)
) USING DELTA
PARTITIONED BY (school_id, consent_status)
TBLPROPERTIES (
  'delta.autoOptimize.optimizeWrite' = 'true',
  'delta.autoOptimize.autoCompact' = 'true'
);

-- =====================================================
-- PHASE 5: ACTIVITY TABLES
-- =====================================================

-- Transcriptions
CREATE TABLE IF NOT EXISTS transcriptions (
  id STRING NOT NULL,
  
  -- Session Context
  session_id STRING NOT NULL,
  group_id STRING,
  
  -- Speaker Information
  speaker_id STRING NOT NULL,
  speaker_name STRING NOT NULL,
  speaker_type STRING NOT NULL, -- student, teacher, system
  
  -- Transcription Content
  content TEXT NOT NULL,
  
  -- Timing
  start_time DOUBLE NOT NULL, -- Seconds from session start
  end_time DOUBLE NOT NULL,
  duration DOUBLE NOT NULL,
  
  -- Quality Metrics
  confidence_score DOUBLE NOT NULL DEFAULT 0.0,
  word_count INT,
  
  -- Analysis Flags
  contains_question BOOLEAN DEFAULT false,
  contains_insight BOOLEAN DEFAULT false,
  sentiment_score DOUBLE, -- -1.0 to 1.0
  
  -- Privacy
  has_pii BOOLEAN DEFAULT false,
  redacted_content TEXT, -- Version with PII removed
  
  -- Audit Fields
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY(id)
) USING DELTA
PARTITIONED BY (session_id, date(created_at))
TBLPROPERTIES (
  'delta.autoOptimize.optimizeWrite' = 'true',
  'delta.autoOptimize.autoCompact' = 'true'
);

-- Messages (Text-based communication)
CREATE TABLE IF NOT EXISTS messages (
  id STRING NOT NULL,
  
  -- Context
  session_id STRING NOT NULL,
  group_id STRING,
  
  -- Sender
  sender_id STRING NOT NULL,
  sender_name STRING NOT NULL,
  sender_type STRING NOT NULL, -- student, teacher
  
  -- Message Content
  content TEXT NOT NULL,
  message_type STRING NOT NULL DEFAULT 'text', -- text, emoji, image, system
  
  -- Reply Information
  reply_to_id STRING, -- If this is a reply
  
  -- Timing
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Moderation
  flagged BOOLEAN DEFAULT false,
  flag_reason STRING,
  moderated BOOLEAN DEFAULT false,
  
  -- Audit Fields
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY(id)
) USING DELTA
PARTITIONED BY (session_id, date(created_at))
TBLPROPERTIES (
  'delta.autoOptimize.optimizeWrite' = 'true',
  'delta.autoOptimize.autoCompact' = 'true'
);

-- Teacher Interventions
CREATE TABLE IF NOT EXISTS teacher_interventions (
  id STRING NOT NULL,
  
  -- Context
  session_id STRING NOT NULL,
  teacher_id STRING NOT NULL,
  group_id STRING, -- NULL if session-wide
  student_id STRING, -- NULL if group or session-wide
  
  -- Intervention Details
  intervention_type STRING NOT NULL, -- redirect, encourage, clarify, warn, praise
  intervention_reason STRING NOT NULL,
  intervention_text STRING,
  
  -- AI Suggestion
  ai_suggested BOOLEAN DEFAULT false,
  ai_suggestion_id STRING,
  ai_confidence DOUBLE,
  
  -- Timing
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  response_time_seconds DOUBLE, -- Time from alert to intervention
  
  -- Outcome
  effectiveness_score DOUBLE, -- Measured by subsequent behavior
  student_response STRING, -- positive, negative, neutral, none
  
  -- Audit Fields
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY(id)
) USING DELTA
PARTITIONED BY (session_id, date(created_at))
TBLPROPERTIES (
  'delta.autoOptimize.optimizeWrite' = 'true',
  'delta.autoOptimize.autoCompact' = 'true'
);

-- =====================================================
-- PHASE 6: ANALYTICS TABLES
-- =====================================================

-- Session Analytics
CREATE TABLE IF NOT EXISTS session_analytics (
  id STRING NOT NULL,
  session_id STRING NOT NULL,
  teacher_id STRING NOT NULL,
  
  -- Analysis Metadata
  analysis_type STRING NOT NULL, -- real_time, end_of_session, daily_summary
  analysis_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  analysis_version STRING NOT NULL, -- Version of AI model used
  
  -- Overall Session Scores
  session_overall_score DOUBLE,
  session_letter_grade STRING,
  session_trend STRING, -- improving, declining, stable
  session_effectiveness_score DOUBLE,
  
  -- Cross-group Averages
  avg_critical_thinking DOUBLE,
  avg_participation_balance DOUBLE,
  avg_discussion_quality DOUBLE,
  avg_time_on_task DOUBLE,
  
  -- Participation Metrics
  total_participants INT,
  active_participants INT,
  unique_participants INT,
  participation_rate DOUBLE,
  avg_utterances_per_participant DOUBLE,
  max_utterances INT,
  min_utterances INT,
  utterance_stddev DOUBLE,
  speaking_time_distribution STRING, -- JSON
  
  -- Engagement Metrics
  overall_engagement_score DOUBLE,
  engagement_trend STRING,
  attention_indicators STRING, -- JSON
  question_count INT,
  collaboration_score DOUBLE,
  
  -- Intervention Tracking
  total_interventions INT,
  conflict_alerts INT,
  confusion_indicators INT,
  disengagement_signals INT,
  intervention_rate DOUBLE,
  total_prompts_shown INT,
  total_prompts_used INT,
  
  -- Learning Analytics
  key_topics_discussed STRING, -- JSON array
  learning_objectives_met STRING, -- JSON array
  comprehension_indicators STRING, -- JSON
  critical_thinking_score DOUBLE,
  
  -- Session Context
  session_topic STRING,
  session_goal STRING,
  topic_adherence_score DOUBLE,
  goal_achievement_score DOUBLE,
  grade_level STRING,
  subject_area STRING,
  
  -- Teacher Insights
  intervention_recommendations STRING, -- JSON
  student_support_needed STRING, -- JSON
  positive_moments STRING, -- JSON
  
  -- Technical Metrics
  audio_quality_score DOUBLE,
  transcription_accuracy_score DOUBLE,
  processing_time_seconds DOUBLE,
  connection_stability DOUBLE,
  latency_average DOUBLE,
  error_count INT,
  
  -- Historical Context
  vs_previous_session DOUBLE,
  vs_teacher_average DOUBLE,
  teacher_session_rank INT,
  
  -- Temporal Tracking
  session_date TIMESTAMP,
  session_start_time TIMESTAMP,
  session_end_time TIMESTAMP,
  session_duration_minutes INT,
  
  -- Metadata
  total_analyses INT,
  analysis_confidence DOUBLE,
  data_completeness DOUBLE,
  
  PRIMARY KEY(id)
) USING DELTA
PARTITIONED BY (analysis_type, date(analysis_timestamp))
TBLPROPERTIES (
  'delta.autoOptimize.optimizeWrite' = 'true',
  'delta.autoOptimize.autoCompact' = 'true'
);

-- Group Analytics
CREATE TABLE IF NOT EXISTS group_analytics (
  id STRING NOT NULL,
  group_id STRING NOT NULL,
  session_id STRING NOT NULL,
  
  -- Analysis Metadata
  analysis_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  analysis_version STRING NOT NULL,
  
  -- Overall Group Scores
  overall_score DOUBLE,
  letter_grade STRING,
  group_rank INT,
  
  -- Core Educational Metrics
  critical_thinking_score DOUBLE,
  participation_balance_score DOUBLE,
  discussion_quality_score DOUBLE,
  time_on_task_score DOUBLE,
  
  -- Detailed Participation Metrics
  total_utterances INT,
  unique_speakers INT,
  speaking_equality_index DOUBLE, -- Gini coefficient
  longest_silence_seconds DOUBLE,
  avg_response_time DOUBLE,
  interruption_count INT,
  
  -- Engagement Indicators
  engagement_level STRING, -- high, medium, low
  energy_level DOUBLE,
  focus_score DOUBLE,
  collaboration_effectiveness DOUBLE,
  
  -- Discussion Quality
  question_count INT,
  answer_count INT,
  elaboration_count INT,
  agreement_disagreement_ratio DOUBLE,
  topic_depth_score DOUBLE,
  vocabulary_complexity DOUBLE,
  
  -- Behavioral Patterns
  dominant_speaker_id STRING,
  quiet_members STRING, -- JSON array
  turn_taking_score DOUBLE,
  supportive_behavior_count INT,
  
  -- Learning Indicators
  concept_understanding_score DOUBLE,
  problem_solving_attempts INT,
  creative_solutions_count INT,
  peer_teaching_instances INT,
  
  -- Alert Counts
  confusion_alerts INT,
  conflict_alerts INT,
  offtopic_alerts INT,
  technical_issues INT,
  
  -- Comparative Metrics
  vs_session_average DOUBLE,
  vs_historical_average DOUBLE,
  improvement_from_start DOUBLE,
  
  PRIMARY KEY(id)
) USING DELTA
PARTITIONED BY (session_id, date(analysis_timestamp))
TBLPROPERTIES (
  'delta.autoOptimize.optimizeWrite' = 'true',
  'delta.autoOptimize.autoCompact' = 'true'
);

-- Student Analytics (Individual, COPPA compliant)
CREATE TABLE IF NOT EXISTS student_analytics (
  id STRING NOT NULL,
  student_participant_id STRING NOT NULL,
  session_id STRING NOT NULL,
  group_id STRING,
  
  -- Analysis Metadata
  analysis_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Participation Metrics (No PII)
  speaking_time_seconds DOUBLE,
  utterance_count INT,
  word_count INT,
  
  -- Engagement Metrics
  engagement_score DOUBLE,
  attention_score DOUBLE,
  participation_rank INT,
  
  -- Interaction Metrics
  questions_asked INT,
  responses_given INT,
  peer_interactions INT,
  
  -- Learning Indicators
  concept_mentions INT,
  vocabulary_level DOUBLE,
  contribution_quality DOUBLE,
  
  -- Behavioral Flags (Anonymous)
  needed_support BOOLEAN DEFAULT false,
  showed_leadership BOOLEAN DEFAULT false,
  collaborative_behavior BOOLEAN DEFAULT false,
  
  PRIMARY KEY(id)
) USING DELTA
PARTITIONED BY (session_id, date(analysis_timestamp))
TBLPROPERTIES (
  'delta.autoOptimize.optimizeWrite' = 'true',
  'delta.autoOptimize.autoCompact' = 'true'
);

-- =====================================================
-- PHASE 7: COMPLIANCE TABLES
-- =====================================================

-- Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
  id STRING NOT NULL,
  
  -- Actor Information
  actor_id STRING NOT NULL,
  actor_type STRING NOT NULL, -- teacher, student, system, admin
  
  -- Event Details
  event_type STRING NOT NULL,
  event_category STRING NOT NULL, -- authentication, session, data_access, configuration, compliance
  event_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Resource Information
  resource_type STRING NOT NULL,
  resource_id STRING NOT NULL,
  
  -- Context
  school_id STRING NOT NULL,
  session_id STRING,
  
  -- Event Data
  description STRING NOT NULL,
  event_data STRING, -- JSON with additional details
  
  -- Request Information
  ip_address STRING,
  user_agent STRING,
  request_id STRING,
  
  -- Compliance
  compliance_basis STRING, -- ferpa, coppa, legitimate_interest, consent
  data_accessed STRING, -- JSON of fields accessed
  
  -- Student Privacy
  affected_student_ids STRING, -- JSON array (encrypted)
  contains_student_data BOOLEAN DEFAULT false,
  
  -- Result
  success BOOLEAN NOT NULL DEFAULT true,
  error_message STRING,
  
  -- Retention
  retention_date TIMESTAMP,
  
  -- Audit
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY(id)
) USING DELTA
PARTITIONED BY (event_category, date(event_timestamp))
TBLPROPERTIES (
  'delta.autoOptimize.optimizeWrite' = 'true',
  'delta.autoOptimize.autoCompact' = 'true'
);

-- COPPA Data Protection
CREATE TABLE IF NOT EXISTS coppa_data_protection (
  id STRING NOT NULL,
  
  -- Reference
  student_id STRING NOT NULL,
  data_type STRING NOT NULL, -- personal_info, voice_recording, behavioral_data, academic_data
  
  -- Protection Status
  protection_status STRING NOT NULL, -- protected, minimal, consented, deleted
  encryption_status BOOLEAN NOT NULL DEFAULT true,
  
  -- Data Location
  storage_location STRING NOT NULL, -- databricks, redis, archived, deleted
  retention_end_date TIMESTAMP NOT NULL,
  
  -- Access Control
  access_restricted BOOLEAN NOT NULL DEFAULT true,
  allowed_users STRING, -- JSON array of user IDs
  
  -- Deletion Schedule
  scheduled_deletion_date TIMESTAMP NOT NULL,
  deletion_confirmed BOOLEAN DEFAULT false,
  deletion_timestamp TIMESTAMP,
  
  -- Audit
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY(id)
) USING DELTA
PARTITIONED BY (protection_status)
TBLPROPERTIES (
  'delta.autoOptimize.optimizeWrite' = 'true',
  'delta.autoOptimize.autoCompact' = 'true'
);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

-- Note: Databricks handles indexing automatically through Delta Lake
-- These are logical indexes for documentation purposes

-- Schools indexes
-- CREATE INDEX idx_schools_domain ON schools (domain);

-- Teachers indexes  
-- CREATE INDEX idx_teachers_google_id ON teachers (google_id);
-- CREATE INDEX idx_teachers_email ON teachers (email);
-- CREATE INDEX idx_teachers_school_status ON teachers (school_id, status);

-- Sessions indexes
-- CREATE INDEX idx_sessions_teacher ON sessions (teacher_id, created_at);
-- CREATE INDEX idx_sessions_school ON sessions (school_id, status);

-- Student participants indexes
-- CREATE INDEX idx_participants_session ON student_participants (session_id, is_active);
-- CREATE INDEX idx_participants_token ON student_participants (join_token);

-- Transcriptions indexes
-- CREATE INDEX idx_transcriptions_session ON transcriptions (session_id, start_time);

-- Audit log indexes
-- CREATE INDEX idx_audit_actor ON audit_log (actor_id, event_timestamp);
-- CREATE INDEX idx_audit_student ON audit_log (affected_student_ids, event_timestamp);
-- CREATE INDEX idx_audit_compliance ON audit_log (event_category, compliance_basis, event_timestamp);

-- Consent indexes
-- CREATE INDEX idx_consent_student ON parental_consent_records (student_id, consent_status);
-- CREATE INDEX idx_consent_school ON parental_consent_records (school_id, consent_status);

-- =====================================================
-- INITIAL DATA INSERTS
-- =====================================================

-- Insert ClassWaves Admin Domain
INSERT INTO schools (
  id,
  name, 
  domain,
  admin_email,
  subscription_tier,
  subscription_status,
  max_teachers,
  current_teachers,
  ferpa_agreement,
  coppa_compliant,
  data_retention_days,
  created_at,
  updated_at
) VALUES (
  'classwaves_admin_001',
  'ClassWaves Administration',
  'classwaves.ai', 
  'rob@classwaves.ai',
  'enterprise',
  'active',
  50,
  1,
  true,
  true,  
  365,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- Insert Super Admin User placeholder
-- Note: google_id will be populated when Rob first logs in
INSERT INTO teachers (
  id,
  google_id,
  email,
  name,
  school_id,
  role,
  status,
  access_level,
  max_concurrent_sessions,
  current_sessions,
  timezone,
  features_enabled,
  last_login,
  login_count,
  total_sessions_created,
  created_at,
  updated_at
) VALUES (
  'rob_admin_001',
  'placeholder_google_id', -- Will be updated on first login
  'rob@classwaves.ai',
  'Rob Taroncher',
  'classwaves_admin_001',
  'super_admin',
  'active',
  'enterprise',
  999, -- Unlimited sessions for admin
  0,
  'America/Los_Angeles',
  '["all"]', -- All features enabled
  NULL,
  0,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- =====================================================
-- FINAL SETUP
-- =====================================================

-- Optimize all tables
OPTIMIZE schools;
OPTIMIZE teachers;
OPTIMIZE sessions;
OPTIMIZE groups;
OPTIMIZE student_participants;
OPTIMIZE transcriptions;
OPTIMIZE messages;
OPTIMIZE teacher_interventions;
OPTIMIZE session_analytics;
OPTIMIZE group_analytics;
OPTIMIZE student_analytics;
OPTIMIZE audit_log;
OPTIMIZE parental_consent_records;
OPTIMIZE registered_students;
OPTIMIZE data_retention_policies;
OPTIMIZE coppa_data_protection;

-- Analyze tables for better query performance
ANALYZE TABLE schools COMPUTE STATISTICS;
ANALYZE TABLE teachers COMPUTE STATISTICS;
ANALYZE TABLE sessions COMPUTE STATISTICS;

-- Success message
SELECT 'ClassWaves database schema created successfully!' as message;
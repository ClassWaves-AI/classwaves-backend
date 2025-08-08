-- ClassWaves Database Schema for Databricks
-- Fixed for Databricks compatibility:
-- 1. Removed column default values (need table properties)
-- 2. Changed TEXT to STRING
-- 3. Removed partitioning by expressions
-- 4. Using Delta table format

-- ================================================================
-- 1. Create Catalog and Schema
-- ================================================================
CREATE CATALOG IF NOT EXISTS classwaves;
USE CATALOG classwaves;
CREATE SCHEMA IF NOT EXISTS main;
USE SCHEMA main;

-- ================================================================
-- 2. Core Tables
-- ================================================================

-- 2.1 Schools - Central entity for multi-tenant architecture
CREATE TABLE IF NOT EXISTS schools (
  id STRING NOT NULL,
  name STRING NOT NULL,
  domain STRING NOT NULL,
  google_workspace_id STRING,
  admin_email STRING NOT NULL,
  
  -- Subscription fields
  subscription_tier STRING NOT NULL, -- 'free', 'basic', 'premium', 'enterprise'
  subscription_status STRING NOT NULL, -- 'trial', 'active', 'suspended', 'canceled'
  max_teachers INT NOT NULL,
  current_teachers INT NOT NULL,
  stripe_customer_id STRING,
  subscription_start_date TIMESTAMP,
  subscription_end_date TIMESTAMP,
  trial_ends_at TIMESTAMP,
  
  -- Compliance fields
  ferpa_agreement BOOLEAN NOT NULL,
  coppa_compliant BOOLEAN NOT NULL,
  data_retention_days INT NOT NULL,
  
  -- Timestamps
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id)
) USING DELTA;

-- Create index on domain for lookups
CREATE INDEX idx_schools_domain ON schools(domain);

-- 2.2 Data Retention Policies
CREATE TABLE IF NOT EXISTS data_retention_policies (
  id STRING NOT NULL,
  school_id STRING NOT NULL,
  
  policy_type STRING NOT NULL, -- 'session', 'transcript', 'analytics', 'audit'
  retention_days INT NOT NULL,
  delete_after_days INT,
  archive_after_days INT,
  
  -- Compliance
  legal_basis STRING NOT NULL, -- 'ferpa', 'coppa', 'legitimate_interest', 'consent'
  auto_delete_enabled BOOLEAN NOT NULL,
  
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id),
  FOREIGN KEY (school_id) REFERENCES schools(id)
) USING DELTA;

-- 2.3 Teachers - Users who manage sessions
CREATE TABLE IF NOT EXISTS teachers (
  id STRING NOT NULL,
  
  -- Google OAuth fields
  google_id STRING NOT NULL,
  email STRING NOT NULL,
  name STRING NOT NULL,
  picture STRING,
  
  -- School relationship
  school_id STRING NOT NULL,
  
  -- Access control
  role STRING NOT NULL, -- 'teacher', 'admin', 'super_admin'
  status STRING NOT NULL, -- 'pending', 'active', 'suspended', 'deactivated'
  access_level STRING NOT NULL,
  
  -- Quotas
  max_concurrent_sessions INT NOT NULL,
  current_sessions INT NOT NULL,
  
  -- Profile
  grade STRING,
  subject STRING,
  timezone STRING NOT NULL,
  features_enabled STRING, -- JSON array of enabled features
  
  -- Activity tracking
  last_login TIMESTAMP,
  login_count INT NOT NULL,
  total_sessions_created INT NOT NULL,
  
  -- Timestamps
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id),
  FOREIGN KEY (school_id) REFERENCES schools(id)
) USING DELTA;

CREATE INDEX idx_teachers_google_id ON teachers(google_id);
CREATE INDEX idx_teachers_email ON teachers(email);
CREATE INDEX idx_teachers_school_id ON teachers(school_id);

-- 2.4 Registered Students (COPPA compliant)
CREATE TABLE IF NOT EXISTS registered_students (
  id STRING NOT NULL,
  
  -- COPPA compliant fields (no PII for under 13)
  display_name STRING NOT NULL, -- Anonymous display name
  school_id STRING NOT NULL,
  
  -- For 13+ only (nullable)
  email STRING,
  google_id STRING,
  
  -- Access
  status STRING NOT NULL, -- 'active', 'inactive', 'graduated'
  grade_level STRING,
  
  -- Parent/Guardian info (COPPA requirement)
  has_parental_consent BOOLEAN NOT NULL,
  consent_date TIMESTAMP,
  parent_email STRING, -- For consent verification
  
  -- Privacy settings
  data_sharing_consent BOOLEAN NOT NULL,
  audio_recording_consent BOOLEAN NOT NULL,
  
  -- Timestamps
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id),
  FOREIGN KEY (school_id) REFERENCES schools(id)
) USING DELTA;

-- ================================================================
-- 3. Session Management Tables
-- ================================================================

-- 3.1 Sessions - Main collaboration sessions
CREATE TABLE IF NOT EXISTS sessions (
  id STRING NOT NULL,
  
  -- Basic info
  title STRING NOT NULL,
  description STRING,
  status STRING NOT NULL, -- 'created', 'active', 'paused', 'ended', 'archived'
  
  -- Scheduling
  scheduled_start TIMESTAMP,
  actual_start TIMESTAMP,
  actual_end TIMESTAMP,
  planned_duration_minutes INT NOT NULL,
  actual_duration_minutes INT,
  
  -- Configuration
  max_students INT NOT NULL,
  target_group_size INT NOT NULL,
  auto_group_enabled BOOLEAN NOT NULL,
  
  -- Relationships
  teacher_id STRING NOT NULL,
  school_id STRING NOT NULL,
  
  -- Features
  recording_enabled BOOLEAN NOT NULL,
  transcription_enabled BOOLEAN NOT NULL,
  ai_analysis_enabled BOOLEAN NOT NULL,
  
  -- Compliance
  ferpa_compliant BOOLEAN NOT NULL,
  coppa_compliant BOOLEAN NOT NULL,
  recording_consent_obtained BOOLEAN NOT NULL,
  data_retention_date TIMESTAMP,
  
  -- Analytics summary
  total_groups INT NOT NULL,
  total_students INT NOT NULL,
  participation_rate DECIMAL(5,2) NOT NULL,
  engagement_score DECIMAL(5,2) NOT NULL,
  
  -- Timestamps
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id),
  FOREIGN KEY (teacher_id) REFERENCES teachers(id),
  FOREIGN KEY (school_id) REFERENCES schools(id)
) USING DELTA
PARTITIONED BY (school_id);

CREATE INDEX idx_sessions_teacher_id ON sessions(teacher_id);
CREATE INDEX idx_sessions_status ON sessions(status);

-- 3.2 Groups within sessions
CREATE TABLE IF NOT EXISTS groups (
  id STRING NOT NULL,
  session_id STRING NOT NULL,
  
  -- Group info
  name STRING NOT NULL,
  group_number INT NOT NULL,
  status STRING NOT NULL, -- 'waiting', 'active', 'paused', 'completed'
  
  -- Configuration
  max_size INT NOT NULL,
  current_size INT NOT NULL,
  auto_managed BOOLEAN NOT NULL,
  
  -- Activity tracking
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  total_speaking_time_seconds INT,
  
  -- Analytics summary
  participation_balance DECIMAL(5,2),
  collaboration_score DECIMAL(5,2),
  topic_focus_score DECIMAL(5,2),
  
  -- Timestamps
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
) USING DELTA;

CREATE INDEX idx_groups_session_id ON groups(session_id);

-- 3.3 Student participants in sessions
CREATE TABLE IF NOT EXISTS student_participants (
  id STRING NOT NULL,
  
  -- Session info
  session_id STRING NOT NULL,
  group_id STRING,
  
  -- Student identification (COPPA compliant)
  registered_student_id STRING, -- If registered
  anonymous_id STRING, -- If not registered
  display_name STRING NOT NULL,
  
  -- Join info
  join_time TIMESTAMP NOT NULL,
  leave_time TIMESTAMP,
  is_active BOOLEAN NOT NULL,
  
  -- Device/connection info
  device_type STRING,
  browser_info STRING,
  connection_quality STRING,
  
  -- Permissions for this session
  can_speak BOOLEAN NOT NULL,
  can_hear BOOLEAN NOT NULL,
  is_muted BOOLEAN NOT NULL,
  
  -- Activity summary
  total_speaking_time_seconds INT,
  message_count INT,
  interaction_count INT,
  
  -- Timestamps
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id),
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  FOREIGN KEY (group_id) REFERENCES groups(id),
  FOREIGN KEY (registered_student_id) REFERENCES registered_students(id)
) USING DELTA
PARTITIONED BY (session_id);

CREATE INDEX idx_participants_session_id ON student_participants(session_id);
CREATE INDEX idx_participants_group_id ON student_participants(group_id);

-- 3.4 Parental Consent Records (COPPA compliance)
CREATE TABLE IF NOT EXISTS parental_consent_records (
  id STRING NOT NULL,
  
  -- Student info
  student_id STRING NOT NULL,
  school_id STRING NOT NULL,
  
  -- Consent details
  consent_type STRING NOT NULL, -- 'registration', 'audio_recording', 'data_sharing', 'ai_analysis'
  consent_given BOOLEAN NOT NULL,
  consent_date TIMESTAMP NOT NULL,
  
  -- Parent/Guardian info
  parent_name STRING NOT NULL,
  parent_email STRING NOT NULL,
  relationship STRING NOT NULL, -- 'parent', 'guardian', 'authorized_adult'
  
  -- Verification
  verification_method STRING NOT NULL, -- 'email', 'signed_form', 'credit_card', 'id_verification'
  verification_token STRING,
  verified_at TIMESTAMP,
  
  -- Legal
  ip_address STRING,
  user_agent STRING,
  consent_text_version STRING NOT NULL,
  
  -- Expiration
  expires_at TIMESTAMP,
  revoked_at TIMESTAMP,
  
  -- Timestamps
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id),
  FOREIGN KEY (student_id) REFERENCES registered_students(id),
  FOREIGN KEY (school_id) REFERENCES schools(id)
) USING DELTA;

CREATE INDEX idx_consent_student_id ON parental_consent_records(student_id);

-- ================================================================
-- 4. Collaboration & Communication Tables
-- ================================================================

-- 4.1 Transcriptions from speech
CREATE TABLE IF NOT EXISTS transcriptions (
  id STRING NOT NULL,
  
  -- Session context
  session_id STRING NOT NULL,
  group_id STRING,
  
  -- Speaker info
  speaker_id STRING NOT NULL, -- participant_id or teacher_id
  speaker_type STRING NOT NULL, -- 'student', 'teacher'
  speaker_name STRING NOT NULL,
  
  -- Transcription
  content STRING NOT NULL,
  language_code STRING NOT NULL,
  
  -- Timing
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  duration_seconds DECIMAL(10,3) NOT NULL,
  
  -- Quality
  confidence_score DECIMAL(5,4) NOT NULL,
  is_final BOOLEAN NOT NULL,
  
  -- AI Analysis
  sentiment STRING,
  key_phrases STRING, -- JSON array
  academic_vocabulary_detected BOOLEAN,
  
  -- Timestamps
  created_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id),
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  FOREIGN KEY (group_id) REFERENCES groups(id)
) USING DELTA
PARTITIONED BY (session_id);

CREATE INDEX idx_transcriptions_session_id ON transcriptions(session_id);
CREATE INDEX idx_transcriptions_group_id ON transcriptions(group_id);
CREATE INDEX idx_transcriptions_speaker_id ON transcriptions(speaker_id);

-- 4.2 Messages (text chat)
CREATE TABLE IF NOT EXISTS messages (
  id STRING NOT NULL,
  
  -- Context
  session_id STRING NOT NULL,
  group_id STRING,
  
  -- Sender
  sender_id STRING NOT NULL,
  sender_type STRING NOT NULL, -- 'student', 'teacher', 'system'
  sender_name STRING NOT NULL,
  
  -- Message
  content STRING NOT NULL,
  message_type STRING NOT NULL, -- 'text', 'emoji', 'sticker', 'system'
  
  -- Metadata
  reply_to_id STRING,
  edited BOOLEAN NOT NULL,
  deleted BOOLEAN NOT NULL,
  
  -- Timestamps
  created_at TIMESTAMP NOT NULL,
  edited_at TIMESTAMP,
  deleted_at TIMESTAMP,
  
  PRIMARY KEY (id),
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  FOREIGN KEY (group_id) REFERENCES groups(id)
) USING DELTA;

CREATE INDEX idx_messages_session_id ON messages(session_id);
CREATE INDEX idx_messages_group_id ON messages(group_id);

-- 4.3 Teacher interventions/support
CREATE TABLE IF NOT EXISTS teacher_interventions (
  id STRING NOT NULL,
  
  -- Context
  session_id STRING NOT NULL,
  group_id STRING,
  teacher_id STRING NOT NULL,
  
  -- Intervention details
  intervention_type STRING NOT NULL, -- 'redirect', 'praise', 'question', 'technical_help', 'behavior'
  urgency STRING NOT NULL, -- 'low', 'medium', 'high'
  
  -- Content
  message STRING,
  action_taken STRING NOT NULL,
  
  -- Target
  target_type STRING NOT NULL, -- 'individual', 'group', 'all'
  target_student_id STRING,
  
  -- Outcome
  was_effective BOOLEAN,
  follow_up_needed BOOLEAN,
  
  -- Timestamps
  created_at TIMESTAMP NOT NULL,
  resolved_at TIMESTAMP,
  
  PRIMARY KEY (id),
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  FOREIGN KEY (group_id) REFERENCES groups(id),
  FOREIGN KEY (teacher_id) REFERENCES teachers(id)
) USING DELTA
PARTITIONED BY (session_id);

-- ================================================================
-- 5. Analytics Tables
-- ================================================================

-- 5.1 Session-level analytics
CREATE TABLE IF NOT EXISTS session_analytics (
  id STRING NOT NULL,
  session_id STRING NOT NULL,
  
  -- Calculated at session end
  calculation_timestamp TIMESTAMP NOT NULL,
  
  -- Participation metrics
  total_students INT NOT NULL,
  active_students INT NOT NULL,
  participation_rate DECIMAL(5,2) NOT NULL,
  average_speaking_time_seconds DECIMAL(10,2),
  speaking_time_std_dev DECIMAL(10,2),
  
  -- Engagement metrics
  overall_engagement_score DECIMAL(5,2) NOT NULL,
  attention_score DECIMAL(5,2),
  interaction_score DECIMAL(5,2),
  collaboration_score DECIMAL(5,2),
  
  -- Academic metrics
  on_topic_percentage DECIMAL(5,2),
  academic_vocabulary_usage DECIMAL(5,2),
  question_asking_rate DECIMAL(5,2),
  
  -- Group dynamics
  group_formation_time_seconds INT,
  average_group_size DECIMAL(5,2),
  group_stability_score DECIMAL(5,2),
  
  -- Technical metrics
  average_connection_quality DECIMAL(5,2),
  technical_issues_count INT,
  
  -- Timestamps
  created_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
) USING DELTA
PARTITIONED BY (session_id);

-- 5.2 Group-level analytics
CREATE TABLE IF NOT EXISTS group_analytics (
  id STRING NOT NULL,
  group_id STRING NOT NULL,
  session_id STRING NOT NULL,
  
  -- Calculated periodically during session
  calculation_timestamp TIMESTAMP NOT NULL,
  
  -- Participation balance
  participation_equality_index DECIMAL(5,4), -- Gini coefficient
  dominant_speaker_percentage DECIMAL(5,2),
  silent_members_count INT,
  
  -- Collaboration quality
  turn_taking_score DECIMAL(5,2),
  interruption_rate DECIMAL(5,2),
  supportive_interactions_count INT,
  
  -- Content analysis
  topic_coherence_score DECIMAL(5,2),
  vocabulary_diversity_score DECIMAL(5,2),
  academic_discourse_score DECIMAL(5,2),
  
  -- Emotional tone
  average_sentiment_score DECIMAL(5,2),
  emotional_support_instances INT,
  conflict_instances INT,
  
  -- Timestamps
  created_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id),
  FOREIGN KEY (group_id) REFERENCES groups(id),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
) USING DELTA
PARTITIONED BY (session_id);

-- 5.3 Individual student analytics
CREATE TABLE IF NOT EXISTS student_analytics (
  id STRING NOT NULL,
  student_participant_id STRING NOT NULL,
  session_id STRING NOT NULL,
  
  -- Calculated at session end
  calculation_timestamp TIMESTAMP NOT NULL,
  
  -- Speaking metrics
  total_speaking_time_seconds INT NOT NULL,
  speaking_turns_count INT,
  average_turn_duration_seconds DECIMAL(10,2),
  
  -- Participation quality
  participation_score DECIMAL(5,2),
  initiative_score DECIMAL(5,2), -- How often they start conversations
  responsiveness_score DECIMAL(5,2), -- How well they respond to others
  
  -- Language metrics
  vocabulary_complexity_score DECIMAL(5,2),
  grammar_accuracy_score DECIMAL(5,2),
  fluency_score DECIMAL(5,2),
  
  -- Collaboration metrics
  peer_interaction_count INT,
  supportive_comments_count INT,
  questions_asked_count INT,
  
  -- Emotional indicators
  average_sentiment DECIMAL(5,2),
  confidence_level DECIMAL(5,2),
  stress_indicators_count INT,
  
  -- Timestamps
  created_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id),
  FOREIGN KEY (student_participant_id) REFERENCES student_participants(id),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
) USING DELTA
PARTITIONED BY (session_id);

-- ================================================================
-- 6. Compliance & Audit Tables
-- ================================================================

-- 6.1 Comprehensive audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id STRING NOT NULL,
  
  -- Actor information
  actor_id STRING NOT NULL,
  actor_type STRING NOT NULL, -- 'teacher', 'student', 'system', 'admin'
  
  -- Event details
  event_type STRING NOT NULL, -- 'login', 'logout', 'create', 'update', 'delete', 'access', 'export'
  event_category STRING NOT NULL, -- 'authentication', 'session', 'data_access', 'configuration', 'compliance'
  event_timestamp TIMESTAMP NOT NULL,
  
  -- Resource affected
  resource_type STRING NOT NULL, -- 'session', 'student_data', 'transcript', 'analytics'
  resource_id STRING,
  
  -- Context
  school_id STRING NOT NULL,
  session_id STRING,
  
  -- Details
  description STRING NOT NULL,
  ip_address STRING,
  user_agent STRING,
  
  -- Compliance tracking
  compliance_basis STRING, -- 'ferpa', 'coppa', 'legitimate_interest', 'consent'
  data_accessed STRING, -- JSON of fields/data accessed
  affected_student_ids STRING, -- JSON array
  
  -- Timestamps
  created_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id),
  FOREIGN KEY (school_id) REFERENCES schools(id)
) USING DELTA
PARTITIONED BY (school_id, event_timestamp);

CREATE INDEX idx_audit_actor_id ON audit_log(actor_id);
CREATE INDEX idx_audit_event_type ON audit_log(event_type);
CREATE INDEX idx_audit_resource ON audit_log(resource_type, resource_id);

-- 6.2 COPPA compliance tracking
CREATE TABLE IF NOT EXISTS coppa_data_protection (
  id STRING NOT NULL,
  
  -- Student info
  student_id STRING NOT NULL,
  school_id STRING NOT NULL,
  
  -- Age verification
  birth_year INT, -- Only year for privacy
  is_under_13 BOOLEAN NOT NULL,
  age_verification_method STRING,
  age_verified_at TIMESTAMP,
  
  -- Data collection settings
  data_collection_limited BOOLEAN NOT NULL,
  no_behavioral_targeting BOOLEAN NOT NULL,
  no_third_party_sharing BOOLEAN NOT NULL,
  
  -- Deletion settings
  auto_delete_enabled BOOLEAN NOT NULL,
  delete_after_days INT,
  deletion_requested_at TIMESTAMP,
  deletion_completed_at TIMESTAMP,
  
  -- Parent access
  parent_access_enabled BOOLEAN NOT NULL,
  parent_last_reviewed TIMESTAMP,
  
  -- Timestamps
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id),
  FOREIGN KEY (student_id) REFERENCES registered_students(id),
  FOREIGN KEY (school_id) REFERENCES schools(id)
) USING DELTA;

CREATE INDEX idx_coppa_student_id ON coppa_data_protection(student_id);

-- ================================================================
-- 7. Initial Data & Table Properties
-- ================================================================

-- Enable column defaults for Delta tables that need them
ALTER TABLE schools SET TBLPROPERTIES('delta.feature.allowColumnDefaults' = 'supported');
ALTER TABLE teachers SET TBLPROPERTIES('delta.feature.allowColumnDefaults' = 'supported');
ALTER TABLE sessions SET TBLPROPERTIES('delta.feature.allowColumnDefaults' = 'supported');
ALTER TABLE groups SET TBLPROPERTIES('delta.feature.allowColumnDefaults' = 'supported');
ALTER TABLE student_participants SET TBLPROPERTIES('delta.feature.allowColumnDefaults' = 'supported');
ALTER TABLE transcriptions SET TBLPROPERTIES('delta.feature.allowColumnDefaults' = 'supported');
ALTER TABLE messages SET TBLPROPERTIES('delta.feature.allowColumnDefaults' = 'supported');

-- Insert test data
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
  'sch_demo_001',
  'Demo Elementary School',
  'demo.classwaves.com',
  'admin@demo.classwaves.com',
  'premium',
  'active',
  50,
  0,
  true,
  true,
  365,
  current_timestamp(),
  current_timestamp()
);

-- Insert demo teacher
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
  login_count,
  total_sessions_created,
  created_at,
  updated_at
) VALUES (
  'tch_demo_001',
  'demo_google_id_12345',
  'teacher@demo.classwaves.com',
  'Demo Teacher',
  'sch_demo_001',
  'teacher',
  'active',
  'full',
  5,
  0,
  'America/Los_Angeles',
  0,
  0,
  current_timestamp(),
  current_timestamp()
);

-- Optimize tables for better performance
OPTIMIZE schools;
OPTIMIZE teachers;

-- Show final table count
SELECT 'Tables created successfully!' as status;
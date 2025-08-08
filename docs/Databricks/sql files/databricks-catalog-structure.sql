-- ================================================================
-- ClassWaves Databricks Unity Catalog Structure
-- ================================================================
-- Hierarchy: Catalog → Schema → Tables
-- 
-- Catalog: classwaves
-- Schemas:
--   1. users         - User management and authentication
--   2. sessions      - Session management and real-time data
--   3. analytics     - Educational metrics and analytics
--   4. compliance    - FERPA/COPPA compliance and audit
--   5. ai_insights   - AI analysis results and insights
--   6. operational   - System operations and monitoring
-- ================================================================

-- Drop and recreate catalog for clean setup
DROP CATALOG IF EXISTS classwaves CASCADE;
CREATE CATALOG classwaves;
USE CATALOG classwaves;

-- ================================================================
-- 1. USERS SCHEMA - Authentication and user management
-- ================================================================
CREATE SCHEMA IF NOT EXISTS users;
USE SCHEMA users;

-- Schools/Organizations
CREATE TABLE IF NOT EXISTS schools (
  id STRING NOT NULL,
  name STRING NOT NULL,
  domain STRING NOT NULL,
  google_workspace_id STRING,
  admin_email STRING NOT NULL,
  
  -- Subscription
  subscription_tier STRING NOT NULL,
  subscription_status STRING NOT NULL,
  max_teachers INT NOT NULL,
  current_teachers INT NOT NULL,
  stripe_customer_id STRING,
  subscription_start_date TIMESTAMP,
  subscription_end_date TIMESTAMP,
  trial_ends_at TIMESTAMP,
  
  -- Compliance
  ferpa_agreement BOOLEAN NOT NULL,
  coppa_compliant BOOLEAN NOT NULL,
  data_retention_days INT NOT NULL,
  
  -- Metadata
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id)
) USING DELTA;

-- Teachers
CREATE TABLE IF NOT EXISTS teachers (
  id STRING NOT NULL,
  google_id STRING NOT NULL,
  email STRING NOT NULL,
  name STRING NOT NULL,
  picture STRING,
  school_id STRING NOT NULL,
  
  -- Access control
  role STRING NOT NULL,
  status STRING NOT NULL,
  access_level STRING NOT NULL,
  max_concurrent_sessions INT NOT NULL,
  current_sessions INT NOT NULL,
  
  -- Profile
  grade STRING,
  subject STRING,
  timezone STRING NOT NULL,
  features_enabled STRING,
  
  -- Activity
  last_login TIMESTAMP,
  login_count INT NOT NULL,
  total_sessions_created INT NOT NULL,
  
  -- Metadata
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id),
  FOREIGN KEY (school_id) REFERENCES schools(id)
) USING DELTA;

-- Students (COPPA compliant)
CREATE TABLE IF NOT EXISTS students (
  id STRING NOT NULL,
  display_name STRING NOT NULL,
  school_id STRING NOT NULL,
  
  -- Optional for 13+
  email STRING,
  google_id STRING,
  
  -- Status
  status STRING NOT NULL,
  grade_level STRING,
  
  -- Consent
  has_parental_consent BOOLEAN NOT NULL,
  consent_date TIMESTAMP,
  parent_email STRING,
  data_sharing_consent BOOLEAN NOT NULL,
  audio_recording_consent BOOLEAN NOT NULL,
  
  -- Metadata
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id),
  FOREIGN KEY (school_id) REFERENCES schools(id)
) USING DELTA;

-- ================================================================
-- 2. SESSIONS SCHEMA - Real-time session management
-- ================================================================
CREATE SCHEMA IF NOT EXISTS sessions;
USE SCHEMA sessions;

-- Main session table
CREATE TABLE IF NOT EXISTS classroom_sessions (
  id STRING NOT NULL,
  title STRING NOT NULL,
  description STRING,
  status STRING NOT NULL,
  
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
  
  -- Summary metrics
  total_groups INT NOT NULL,
  total_students INT NOT NULL,
  participation_rate DECIMAL(5,2) NOT NULL,
  engagement_score DECIMAL(5,2) NOT NULL,
  
  -- Metadata
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id)
) USING DELTA
PARTITIONED BY (school_id, DATE(created_at));

-- Student groups within sessions
CREATE TABLE IF NOT EXISTS student_groups (
  id STRING NOT NULL,
  session_id STRING NOT NULL,
  name STRING NOT NULL,
  group_number INT NOT NULL,
  status STRING NOT NULL,
  
  -- Configuration
  max_size INT NOT NULL,
  current_size INT NOT NULL,
  auto_managed BOOLEAN NOT NULL,
  
  -- Activity
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  total_speaking_time_seconds INT,
  
  -- Analytics
  participation_balance DECIMAL(5,2),
  collaboration_score DECIMAL(5,2),
  topic_focus_score DECIMAL(5,2),
  
  -- Metadata
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id)
) USING DELTA
PARTITIONED BY (session_id);

-- Student participation records
CREATE TABLE IF NOT EXISTS participants (
  id STRING NOT NULL,
  session_id STRING NOT NULL,
  group_id STRING,
  
  -- Student info
  student_id STRING,
  anonymous_id STRING,
  display_name STRING NOT NULL,
  
  -- Session activity
  join_time TIMESTAMP NOT NULL,
  leave_time TIMESTAMP,
  is_active BOOLEAN NOT NULL,
  
  -- Device info
  device_type STRING,
  browser_info STRING,
  connection_quality STRING,
  
  -- Permissions
  can_speak BOOLEAN NOT NULL,
  can_hear BOOLEAN NOT NULL,
  is_muted BOOLEAN NOT NULL,
  
  -- Activity metrics
  total_speaking_time_seconds INT,
  message_count INT,
  interaction_count INT,
  
  -- Metadata
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id)
) USING DELTA
PARTITIONED BY (session_id);

-- Real-time transcriptions
CREATE TABLE IF NOT EXISTS transcriptions (
  id STRING NOT NULL,
  session_id STRING NOT NULL,
  group_id STRING,
  
  -- Speaker
  speaker_id STRING NOT NULL,
  speaker_type STRING NOT NULL,
  speaker_name STRING NOT NULL,
  
  -- Content
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
  key_phrases STRING,
  academic_vocabulary_detected BOOLEAN,
  
  -- Metadata
  created_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id)
) USING DELTA
PARTITIONED BY (session_id, DATE(start_time));

-- ================================================================
-- 3. ANALYTICS SCHEMA - Educational metrics and insights
-- ================================================================
CREATE SCHEMA IF NOT EXISTS analytics;
USE SCHEMA analytics;

-- Session-level analytics
CREATE TABLE IF NOT EXISTS session_metrics (
  id STRING NOT NULL,
  session_id STRING NOT NULL,
  calculation_timestamp TIMESTAMP NOT NULL,
  
  -- Participation
  total_students INT NOT NULL,
  active_students INT NOT NULL,
  participation_rate DECIMAL(5,2) NOT NULL,
  average_speaking_time_seconds DECIMAL(10,2),
  speaking_time_std_dev DECIMAL(10,2),
  
  -- Engagement
  overall_engagement_score DECIMAL(5,2) NOT NULL,
  attention_score DECIMAL(5,2),
  interaction_score DECIMAL(5,2),
  collaboration_score DECIMAL(5,2),
  
  -- Academic
  on_topic_percentage DECIMAL(5,2),
  academic_vocabulary_usage DECIMAL(5,2),
  question_asking_rate DECIMAL(5,2),
  
  -- Group dynamics
  group_formation_time_seconds INT,
  average_group_size DECIMAL(5,2),
  group_stability_score DECIMAL(5,2),
  
  -- Technical
  average_connection_quality DECIMAL(5,2),
  technical_issues_count INT,
  
  -- Metadata
  created_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id)
) USING DELTA
PARTITIONED BY (DATE(calculation_timestamp));

-- Group-level analytics
CREATE TABLE IF NOT EXISTS group_metrics (
  id STRING NOT NULL,
  group_id STRING NOT NULL,
  session_id STRING NOT NULL,
  calculation_timestamp TIMESTAMP NOT NULL,
  
  -- Participation balance
  participation_equality_index DECIMAL(5,4),
  dominant_speaker_percentage DECIMAL(5,2),
  silent_members_count INT,
  
  -- Collaboration
  turn_taking_score DECIMAL(5,2),
  interruption_rate DECIMAL(5,2),
  supportive_interactions_count INT,
  
  -- Content
  topic_coherence_score DECIMAL(5,2),
  vocabulary_diversity_score DECIMAL(5,2),
  academic_discourse_score DECIMAL(5,2),
  
  -- Emotional
  average_sentiment_score DECIMAL(5,2),
  emotional_support_instances INT,
  conflict_instances INT,
  
  -- Metadata
  created_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id)
) USING DELTA
PARTITIONED BY (session_id);

-- Individual student analytics
CREATE TABLE IF NOT EXISTS student_metrics (
  id STRING NOT NULL,
  participant_id STRING NOT NULL,
  session_id STRING NOT NULL,
  calculation_timestamp TIMESTAMP NOT NULL,
  
  -- Speaking
  total_speaking_time_seconds INT NOT NULL,
  speaking_turns_count INT,
  average_turn_duration_seconds DECIMAL(10,2),
  
  -- Participation
  participation_score DECIMAL(5,2),
  initiative_score DECIMAL(5,2),
  responsiveness_score DECIMAL(5,2),
  
  -- Language
  vocabulary_complexity_score DECIMAL(5,2),
  grammar_accuracy_score DECIMAL(5,2),
  fluency_score DECIMAL(5,2),
  
  -- Collaboration
  peer_interaction_count INT,
  supportive_comments_count INT,
  questions_asked_count INT,
  
  -- Emotional
  average_sentiment DECIMAL(5,2),
  confidence_level DECIMAL(5,2),
  stress_indicators_count INT,
  
  -- Metadata
  created_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id)
) USING DELTA
PARTITIONED BY (session_id);

-- ================================================================
-- 4. COMPLIANCE SCHEMA - FERPA/COPPA compliance and audit
-- ================================================================
CREATE SCHEMA IF NOT EXISTS compliance;
USE SCHEMA compliance;

-- Comprehensive audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id STRING NOT NULL,
  actor_id STRING NOT NULL,
  actor_type STRING NOT NULL,
  
  -- Event details
  event_type STRING NOT NULL,
  event_category STRING NOT NULL,
  event_timestamp TIMESTAMP NOT NULL,
  
  -- Resource
  resource_type STRING NOT NULL,
  resource_id STRING,
  school_id STRING NOT NULL,
  session_id STRING,
  
  -- Details
  description STRING NOT NULL,
  ip_address STRING,
  user_agent STRING,
  
  -- Compliance
  compliance_basis STRING,
  data_accessed STRING,
  affected_student_ids STRING,
  
  -- Metadata
  created_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id)
) USING DELTA
PARTITIONED BY (school_id, DATE(event_timestamp));

-- Parental consent records
CREATE TABLE IF NOT EXISTS parental_consents (
  id STRING NOT NULL,
  student_id STRING NOT NULL,
  school_id STRING NOT NULL,
  
  -- Consent details
  consent_type STRING NOT NULL,
  consent_given BOOLEAN NOT NULL,
  consent_date TIMESTAMP NOT NULL,
  
  -- Parent info
  parent_name STRING NOT NULL,
  parent_email STRING NOT NULL,
  relationship STRING NOT NULL,
  
  -- Verification
  verification_method STRING NOT NULL,
  verification_token STRING,
  verified_at TIMESTAMP,
  
  -- Legal
  ip_address STRING,
  user_agent STRING,
  consent_text_version STRING NOT NULL,
  
  -- Expiration
  expires_at TIMESTAMP,
  revoked_at TIMESTAMP,
  
  -- Metadata
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id)
) USING DELTA
PARTITIONED BY (school_id);

-- Data retention policies
CREATE TABLE IF NOT EXISTS retention_policies (
  id STRING NOT NULL,
  school_id STRING NOT NULL,
  policy_type STRING NOT NULL,
  
  -- Retention settings
  retention_days INT NOT NULL,
  delete_after_days INT,
  archive_after_days INT,
  
  -- Compliance
  legal_basis STRING NOT NULL,
  auto_delete_enabled BOOLEAN NOT NULL,
  
  -- Metadata
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id)
) USING DELTA;

-- COPPA compliance tracking
CREATE TABLE IF NOT EXISTS coppa_compliance (
  id STRING NOT NULL,
  student_id STRING NOT NULL,
  school_id STRING NOT NULL,
  
  -- Age verification
  birth_year INT,
  is_under_13 BOOLEAN NOT NULL,
  age_verification_method STRING,
  age_verified_at TIMESTAMP,
  
  -- Data settings
  data_collection_limited BOOLEAN NOT NULL,
  no_behavioral_targeting BOOLEAN NOT NULL,
  no_third_party_sharing BOOLEAN NOT NULL,
  
  -- Deletion
  auto_delete_enabled BOOLEAN NOT NULL,
  delete_after_days INT,
  deletion_requested_at TIMESTAMP,
  deletion_completed_at TIMESTAMP,
  
  -- Parent access
  parent_access_enabled BOOLEAN NOT NULL,
  parent_last_reviewed TIMESTAMP,
  
  -- Metadata
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id)
) USING DELTA;

-- ================================================================
-- 5. AI_INSIGHTS SCHEMA - AI analysis and insights
-- ================================================================
CREATE SCHEMA IF NOT EXISTS ai_insights;
USE SCHEMA ai_insights;

-- AI analysis results
CREATE TABLE IF NOT EXISTS analysis_results (
  id STRING NOT NULL,
  session_id STRING NOT NULL,
  analysis_type STRING NOT NULL,
  
  -- Timing
  analysis_timestamp TIMESTAMP NOT NULL,
  processing_time_ms INT NOT NULL,
  
  -- Results
  result_data STRING NOT NULL, -- JSON
  confidence_score DECIMAL(5,4),
  model_version STRING NOT NULL,
  
  -- Metadata
  created_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id)
) USING DELTA
PARTITIONED BY (session_id);

-- Teacher interventions suggested by AI
CREATE TABLE IF NOT EXISTS intervention_suggestions (
  id STRING NOT NULL,
  session_id STRING NOT NULL,
  group_id STRING,
  teacher_id STRING NOT NULL,
  
  -- Suggestion
  intervention_type STRING NOT NULL,
  urgency STRING NOT NULL,
  reason STRING NOT NULL,
  suggested_action STRING NOT NULL,
  
  -- Target
  target_type STRING NOT NULL,
  target_student_id STRING,
  
  -- Status
  status STRING NOT NULL,
  acted_upon BOOLEAN,
  acted_at TIMESTAMP,
  was_effective BOOLEAN,
  
  -- Metadata
  created_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id)
) USING DELTA
PARTITIONED BY (session_id);

-- Educational insights
CREATE TABLE IF NOT EXISTS educational_insights (
  id STRING NOT NULL,
  session_id STRING NOT NULL,
  insight_type STRING NOT NULL,
  
  -- Insight details
  title STRING NOT NULL,
  description STRING NOT NULL,
  recommendations STRING,
  
  -- Metrics
  impact_score DECIMAL(5,2),
  confidence_level DECIMAL(5,2),
  
  -- Target
  applies_to_type STRING NOT NULL,
  applies_to_id STRING,
  
  -- Metadata
  created_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id)
) USING DELTA
PARTITIONED BY (DATE(created_at));

-- ================================================================
-- 6. OPERATIONAL SCHEMA - System operations and monitoring
-- ================================================================
CREATE SCHEMA IF NOT EXISTS operational;
USE SCHEMA operational;

-- System events
CREATE TABLE IF NOT EXISTS system_events (
  id STRING NOT NULL,
  event_type STRING NOT NULL,
  severity STRING NOT NULL,
  
  -- Event details
  component STRING NOT NULL,
  message STRING NOT NULL,
  error_details STRING,
  
  -- Context
  school_id STRING,
  session_id STRING,
  user_id STRING,
  
  -- Metadata
  created_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id)
) USING DELTA
PARTITIONED BY (DATE(created_at));

-- API usage metrics
CREATE TABLE IF NOT EXISTS api_metrics (
  id STRING NOT NULL,
  endpoint STRING NOT NULL,
  method STRING NOT NULL,
  
  -- Metrics
  response_time_ms INT NOT NULL,
  status_code INT NOT NULL,
  
  -- Context
  user_id STRING,
  school_id STRING,
  ip_address STRING,
  user_agent STRING,
  
  -- Metadata
  timestamp TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id)
) USING DELTA
PARTITIONED BY (DATE(timestamp));

-- Background job tracking
CREATE TABLE IF NOT EXISTS background_jobs (
  id STRING NOT NULL,
  job_type STRING NOT NULL,
  status STRING NOT NULL,
  
  -- Execution
  scheduled_at TIMESTAMP NOT NULL,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  
  -- Details
  parameters STRING,
  result STRING,
  error_message STRING,
  retry_count INT NOT NULL,
  
  -- Metadata
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  
  PRIMARY KEY (id)
) USING DELTA;

-- ================================================================
-- 7. Set table properties for Delta features
-- ================================================================
USE CATALOG classwaves;

-- Enable column defaults for all tables that need them
ALTER TABLE users.schools SET TBLPROPERTIES('delta.feature.allowColumnDefaults' = 'supported');
ALTER TABLE users.teachers SET TBLPROPERTIES('delta.feature.allowColumnDefaults' = 'supported');
ALTER TABLE users.students SET TBLPROPERTIES('delta.feature.allowColumnDefaults' = 'supported');
ALTER TABLE sessions.classroom_sessions SET TBLPROPERTIES('delta.feature.allowColumnDefaults' = 'supported');
ALTER TABLE sessions.student_groups SET TBLPROPERTIES('delta.feature.allowColumnDefaults' = 'supported');
ALTER TABLE sessions.participants SET TBLPROPERTIES('delta.feature.allowColumnDefaults' = 'supported');

-- ================================================================
-- 8. Insert initial demo data
-- ================================================================
USE SCHEMA users;

-- Demo school
INSERT INTO schools (
  id, name, domain, admin_email, subscription_tier, subscription_status,
  max_teachers, current_teachers, ferpa_agreement, coppa_compliant,
  data_retention_days, created_at, updated_at
) VALUES (
  'sch_demo_001', 'Demo Elementary School', 'demo.classwaves.com',
  'admin@demo.classwaves.com', 'premium', 'active', 50, 0, true, true,
  365, current_timestamp(), current_timestamp()
);

-- Demo teacher
INSERT INTO teachers (
  id, google_id, email, name, school_id, role, status, access_level,
  max_concurrent_sessions, current_sessions, timezone, login_count,
  total_sessions_created, created_at, updated_at
) VALUES (
  'tch_demo_001', 'demo_google_id_12345', 'teacher@demo.classwaves.com',
  'Demo Teacher', 'sch_demo_001', 'teacher', 'active', 'full', 5, 0,
  'America/Los_Angeles', 0, 0, current_timestamp(), current_timestamp()
);

-- Show summary
SELECT 'ClassWaves catalog structure created successfully!' as status;
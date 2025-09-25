-- ClassWaves local development schema (Postgres)
-- Mirrors the subset of Databricks tables needed for day-to-day CRUD flows.

SET client_min_messages TO WARNING;

-- Schemas
CREATE SCHEMA IF NOT EXISTS sessions;
CREATE SCHEMA IF NOT EXISTS users;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS ai_insights;

-- Sessions
CREATE TABLE IF NOT EXISTS sessions.classroom_sessions (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  status text NOT NULL,
  goal text,
  subject text,
  description text,
  planned_duration_minutes integer,
  teacher_id uuid NOT NULL,
  school_id uuid,
  scheduled_start timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  target_group_size integer,
  max_students integer,
  auto_group_enabled boolean NOT NULL DEFAULT false,
  recording_enabled boolean NOT NULL DEFAULT false,
  transcription_enabled boolean NOT NULL DEFAULT true,
  ai_analysis_enabled boolean NOT NULL DEFAULT true,
  ferpa_compliant boolean NOT NULL DEFAULT true,
  coppa_compliant boolean NOT NULL DEFAULT true,
  recording_consent_obtained boolean NOT NULL DEFAULT false,
  data_retention_date timestamptz,
  total_groups integer,
  total_students integer,
  access_code text,
  engagement_score numeric,
  participation_rate numeric,
  actual_duration_minutes integer,
  end_reason text,
  teacher_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS scheduled_start timestamptz;
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS actual_start timestamptz;
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS actual_end timestamptz;
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS target_group_size integer;
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS max_students integer;
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS auto_group_enabled boolean DEFAULT false;
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS recording_enabled boolean DEFAULT false;
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS transcription_enabled boolean DEFAULT true;
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS ai_analysis_enabled boolean DEFAULT true;
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS ferpa_compliant boolean DEFAULT true;
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS coppa_compliant boolean DEFAULT true;
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS recording_consent_obtained boolean DEFAULT false;
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS data_retention_date timestamptz;
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS total_groups integer;
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS total_students integer;
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS access_code text;
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS engagement_score numeric;
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS participation_rate numeric;
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS actual_duration_minutes integer;
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS end_reason text;
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS teacher_notes text;

CREATE TABLE IF NOT EXISTS sessions.student_groups (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions.classroom_sessions(id) ON DELETE CASCADE,
  name text NOT NULL,
  group_number integer,
  status text,
  max_size integer,
  current_size integer,
  leader_id uuid,
  is_ready boolean NOT NULL DEFAULT false,
  auto_managed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sessions.student_groups ADD COLUMN IF NOT EXISTS leader_id uuid;
ALTER TABLE sessions.student_groups ADD COLUMN IF NOT EXISTS is_ready boolean DEFAULT false;
ALTER TABLE sessions.student_groups ADD COLUMN IF NOT EXISTS auto_managed boolean DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_groups_session_groupnum
  ON sessions.student_groups(session_id, group_number)
  WHERE group_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions.student_group_members (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES sessions.student_groups(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES sessions.classroom_sessions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  role text,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'sessions' AND table_name = 'student_group_members' AND column_name = 'session_id'
  ) THEN
    ALTER TABLE sessions.student_group_members ADD COLUMN session_id uuid;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_group_membership
  ON sessions.student_group_members(group_id, student_id);

-- Participants (mirror of production subset)
CREATE TABLE IF NOT EXISTS sessions.participants (
  id uuid PRIMARY KEY,
  session_id uuid REFERENCES sessions.classroom_sessions(id) ON DELETE CASCADE,
  group_id uuid REFERENCES sessions.student_groups(id) ON DELETE SET NULL,
  student_id uuid,
  anonymous_id uuid,
  display_name text,
  join_time timestamptz,
  leave_time timestamptz,
  is_active boolean DEFAULT true,
  device_type text,
  browser_info text,
  connection_quality text,
  can_speak boolean DEFAULT true,
  can_hear boolean DEFAULT true,
  is_muted boolean DEFAULT false,
  total_speaking_time_seconds integer,
  message_count integer,
  interaction_count integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_participants_session ON sessions.participants(session_id);
CREATE INDEX IF NOT EXISTS idx_participants_group ON sessions.participants(group_id);

-- Users
CREATE TABLE IF NOT EXISTS users.teachers (
  id uuid PRIMARY KEY,
  email text UNIQUE,
  name text,
  school_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users.schools (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  domain text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users.teachers ADD COLUMN IF NOT EXISTS school_id uuid;

CREATE TABLE IF NOT EXISTS users.students (
  id uuid PRIMARY KEY,
  name text,
  display_name text,
  email text,
  school_id uuid,
  grade_level text,
  status text,
  has_parental_consent boolean,
  consent_date timestamptz,
  parent_email text,
  email_consent boolean,
  coppa_compliant boolean,
  teacher_verified_age boolean,
  data_sharing_consent boolean,
  audio_recording_consent boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users.students ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE users.students ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE users.students ADD COLUMN IF NOT EXISTS school_id uuid;
ALTER TABLE users.students ADD COLUMN IF NOT EXISTS grade_level text;
ALTER TABLE users.students ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE users.students ADD COLUMN IF NOT EXISTS has_parental_consent boolean;
ALTER TABLE users.students ADD COLUMN IF NOT EXISTS consent_date timestamptz;
ALTER TABLE users.students ADD COLUMN IF NOT EXISTS parent_email text;
ALTER TABLE users.students ADD COLUMN IF NOT EXISTS email_consent boolean;
ALTER TABLE users.students ADD COLUMN IF NOT EXISTS coppa_compliant boolean;
ALTER TABLE users.students ADD COLUMN IF NOT EXISTS teacher_verified_age boolean;
ALTER TABLE users.students ADD COLUMN IF NOT EXISTS data_sharing_consent boolean;
ALTER TABLE users.students ADD COLUMN IF NOT EXISTS audio_recording_consent boolean;
ALTER TABLE users.students ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE users.students ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE users.students ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE users.students ALTER COLUMN updated_at SET DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_students_school'
      AND conrelid = 'users.students'::regclass
  ) THEN
    ALTER TABLE users.students
      ADD CONSTRAINT fk_students_school
      FOREIGN KEY (school_id)
      REFERENCES users.schools(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_students_school ON users.students(school_id);

-- Analytics Events
CREATE TABLE IF NOT EXISTS analytics.session_events (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions.classroom_sessions(id) ON DELETE CASCADE,
  teacher_id uuid,
  event_type text NOT NULL,
  event_time timestamptz NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_events_session_id
  ON analytics.session_events(session_id);
CREATE INDEX IF NOT EXISTS idx_session_events_time
  ON analytics.session_events(event_time DESC);

-- Teacher guidance metrics
CREATE TABLE IF NOT EXISTS ai_insights.teacher_guidance_metrics (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions.classroom_sessions(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES users.teachers(id) ON DELETE RESTRICT,
  prompt_id uuid NOT NULL,
  prompt_category text NOT NULL,
  priority_level text NOT NULL,
  prompt_message text NOT NULL,
  prompt_context text,
  suggested_timing text,
  session_phase text,
  subject_area text,
  target_metric text,
  learning_objectives jsonb,
  group_id uuid REFERENCES sessions.student_groups(id) ON DELETE SET NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  acknowledged_at timestamptz,
  used_at timestamptz,
  dismissed_at timestamptz,
  feedback_rating numeric,
  feedback_text text,
  response_time_seconds integer,
  context_reason text,
  context_prior_topic text,
  context_current_topic text,
  context_transition_idea text,
  context_supporting_lines jsonb,
  context_confidence numeric,
  bridging_prompt text,
  on_track_summary text,
  effectiveness_score numeric,
  impact_confidence numeric,
  educational_purpose text,
  compliance_basis text,
  data_retention_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_insights.teacher_guidance_metrics ADD COLUMN IF NOT EXISTS feedback_rating numeric;
ALTER TABLE ai_insights.teacher_guidance_metrics ADD COLUMN IF NOT EXISTS feedback_text text;
ALTER TABLE ai_insights.teacher_guidance_metrics ADD COLUMN IF NOT EXISTS response_time_seconds integer;
ALTER TABLE ai_insights.teacher_guidance_metrics ADD COLUMN IF NOT EXISTS educational_purpose text;
ALTER TABLE ai_insights.teacher_guidance_metrics ADD COLUMN IF NOT EXISTS compliance_basis text;
ALTER TABLE ai_insights.teacher_guidance_metrics ADD COLUMN IF NOT EXISTS data_retention_date timestamptz;

CREATE TABLE IF NOT EXISTS ai_insights.teacher_prompt_effectiveness (
  id text PRIMARY KEY,
  prompt_category text NOT NULL,
  subject_area text,
  session_phase text,
  priority_level text,
  total_generated integer NOT NULL DEFAULT 0,
  total_acknowledged integer NOT NULL DEFAULT 0,
  total_used integer NOT NULL DEFAULT 0,
  total_dismissed integer NOT NULL DEFAULT 0,
  avg_effectiveness_score numeric,
  avg_feedback_rating numeric,
  avg_response_time_seconds integer,
  avg_learning_impact numeric,
  data_points integer NOT NULL DEFAULT 0,
  calculation_period_start timestamptz,
  calculation_period_end timestamptz,
  last_calculated timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tpe_category_subject_phase
  ON ai_insights.teacher_prompt_effectiveness(prompt_category, subject_area, session_phase);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_teacher_guidance_metrics_prompt'
      AND conrelid = 'ai_insights.teacher_guidance_metrics'::regclass
  ) THEN
    ALTER TABLE ai_insights.teacher_guidance_metrics
      ADD CONSTRAINT uq_teacher_guidance_metrics_prompt UNIQUE (prompt_id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_tgm_session_id
  ON ai_insights.teacher_guidance_metrics(session_id);
CREATE INDEX IF NOT EXISTS idx_tgm_group_id
  ON ai_insights.teacher_guidance_metrics(group_id);
CREATE INDEX IF NOT EXISTS idx_tgm_generated_at
  ON ai_insights.teacher_guidance_metrics(generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tgm_teacher_id
  ON ai_insights.teacher_guidance_metrics(teacher_id);
CREATE INDEX IF NOT EXISTS idx_tgm_context_lines_gin
  ON ai_insights.teacher_guidance_metrics USING GIN (context_supporting_lines);
CREATE INDEX IF NOT EXISTS idx_tgm_high_priority_time
  ON ai_insights.teacher_guidance_metrics(generated_at)
  WHERE priority_level = 'high';

-- Updated_at trigger helper
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'tg_sessions_updated_at'
  ) THEN
    CREATE TRIGGER tg_sessions_updated_at
    BEFORE UPDATE ON sessions.classroom_sessions
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'tg_student_groups_updated_at'
  ) THEN
    CREATE TRIGGER tg_student_groups_updated_at
    BEFORE UPDATE ON sessions.student_groups
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'tg_tgm_updated_at'
  ) THEN
    CREATE TRIGGER tg_tgm_updated_at
    BEFORE UPDATE ON ai_insights.teacher_guidance_metrics
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
  END IF;
END;
$$;

-- Schema version stamp for local dev
CREATE TABLE IF NOT EXISTS ai_insights.dev_schema_version (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ai_insights.dev_schema_version(version)
VALUES (1)
ON CONFLICT (version) DO NOTHING;

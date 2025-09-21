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
  actual_duration_minutes integer,
  end_reason text,
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
  teacher_notes text,
  engagement_score numeric,
  participation_rate numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS scheduled_start timestamptz;
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS actual_start timestamptz;
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS actual_end timestamptz;
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS actual_duration_minutes integer;
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS end_reason text;
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
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS teacher_notes text;
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS engagement_score numeric;
ALTER TABLE sessions.classroom_sessions ADD COLUMN IF NOT EXISTS participation_rate numeric;

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

-- Users
CREATE TABLE IF NOT EXISTS users.teachers (
  id uuid PRIMARY KEY,
  email text UNIQUE,
  name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users.students (
  id uuid PRIMARY KEY,
  name text,
  display_name text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users.students ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE users.students ADD COLUMN IF NOT EXISTS email text;

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

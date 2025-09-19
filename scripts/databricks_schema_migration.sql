-- SQL SCRIPT FOR PHASE 5: TEACHER-FIRST SESSION WORKFLOW REDESIGN
-- Version: 2.0 (Idempotent)
-- Author: ClassWaves Engineering Team
-- Date: 2025-08-11
-- Purpose: Enable declarative session creation with pre-configured groups and analytics

-- ========================================
-- PHASE 5: SESSION WORKFLOW REDESIGN
-- ========================================

-- 1. Extend student_groups table for declarative group configuration
ALTER TABLE classwaves.sessions.student_groups ADD COLUMN IF NOT EXISTS name STRING COMMENT 'Human-readable group name (e.g., Group A, Team Alpha)';
ALTER TABLE classwaves.sessions.student_groups ADD COLUMN IF NOT EXISTS leader_id STRING COMMENT 'Student ID of the designated group leader';
ALTER TABLE classwaves.sessions.student_groups ADD COLUMN IF NOT EXISTS is_ready BOOLEAN DEFAULT false COMMENT 'Whether group leader has marked the group as ready';

-- 2. Create student_group_members table for explicit group membership
CREATE TABLE IF NOT EXISTS classwaves.sessions.student_group_members (
  id STRING NOT NULL COMMENT 'Unique member assignment ID',
  session_id STRING NOT NULL COMMENT 'Parent session identifier',
  group_id STRING NOT NULL COMMENT 'Parent group identifier', 
  student_id STRING NOT NULL COMMENT 'Student assigned to this group',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'When student was assigned to group'
) USING DELTA
COMMENT 'Explicit student-to-group assignments configured by teacher during session creation';

-- 3. Extend session_metrics table for planned vs actual analytics
ALTER TABLE classwaves.analytics.session_metrics ADD COLUMN IF NOT EXISTS planned_groups INT COMMENT 'Number of groups configured by teacher';
ALTER TABLE classwaves.analytics.session_metrics ADD COLUMN IF NOT EXISTS planned_group_size INT COMMENT 'Target group size configured by teacher';
ALTER TABLE classwaves.analytics.session_metrics ADD COLUMN IF NOT EXISTS planned_duration_minutes INT COMMENT 'Planned session duration in minutes';
ALTER TABLE classwaves.analytics.session_metrics ADD COLUMN IF NOT EXISTS planned_members INT COMMENT 'Total members planned across all groups';
ALTER TABLE classwaves.analytics.session_metrics ADD COLUMN IF NOT EXISTS planned_leaders INT COMMENT 'Number of group leaders assigned';
ALTER TABLE classwaves.analytics.session_metrics ADD COLUMN IF NOT EXISTS planned_scheduled_start TIMESTAMP COMMENT 'Teacher-scheduled start time';
ALTER TABLE classwaves.analytics.session_metrics ADD COLUMN IF NOT EXISTS configured_at TIMESTAMP COMMENT 'When session was fully configured';
ALTER TABLE classwaves.analytics.session_metrics ADD COLUMN IF NOT EXISTS started_at TIMESTAMP COMMENT 'When session was actually started';
ALTER TABLE classwaves.analytics.session_metrics ADD COLUMN IF NOT EXISTS started_without_ready_groups BOOLEAN COMMENT 'Whether session started before all groups were ready';
ALTER TABLE classwaves.analytics.session_metrics ADD COLUMN IF NOT EXISTS ready_groups_at_start INT COMMENT 'Number of groups marked ready when session started';
ALTER TABLE classwaves.analytics.session_metrics ADD COLUMN IF NOT EXISTS ready_groups_at_5m INT COMMENT 'Number of groups ready at 5 minutes';
ALTER TABLE classwaves.analytics.session_metrics ADD COLUMN IF NOT EXISTS ready_groups_at_10m INT COMMENT 'Number of groups ready at 10 minutes';
ALTER TABLE classwaves.analytics.session_metrics ADD COLUMN IF NOT EXISTS adherence_members_ratio DOUBLE COMMENT 'Ratio of actual to planned member participation';

-- 4. Extend group_metrics table for configuration and adherence tracking
ALTER TABLE classwaves.analytics.group_metrics ADD COLUMN IF NOT EXISTS configured_name STRING COMMENT 'Teacher-assigned group name';
ALTER TABLE classwaves.analytics.group_metrics ADD COLUMN IF NOT EXISTS configured_size INT COMMENT 'Number of members assigned to group';
ALTER TABLE classwaves.analytics.group_metrics ADD COLUMN IF NOT EXISTS leader_assigned BOOLEAN COMMENT 'Whether a leader was assigned to this group';
ALTER TABLE classwaves.analytics.group_metrics ADD COLUMN IF NOT EXISTS leader_ready_at TIMESTAMP COMMENT 'When group leader marked ready';
ALTER TABLE classwaves.analytics.group_metrics ADD COLUMN IF NOT EXISTS members_configured INT COMMENT 'Number of members configured for group';
ALTER TABLE classwaves.analytics.group_metrics ADD COLUMN IF NOT EXISTS members_present INT COMMENT 'Number of configured members actually present';

-- 5. Create session_events table for detailed timeline analytics
CREATE TABLE IF NOT EXISTS classwaves.analytics.session_events (
  id STRING NOT NULL COMMENT 'Unique event identifier',
  session_id STRING NOT NULL COMMENT 'Session this event belongs to',
  teacher_id STRING NOT NULL COMMENT 'Teacher who owns the session',
  event_type STRING NOT NULL COMMENT 'Type of event: configured|started|leader_ready|member_join|member_leave|ended',
  event_time TIMESTAMP NOT NULL COMMENT 'When the event occurred',
  payload STRING COMMENT 'JSON string with event-specific data (groupId, counts, etc.)'
) USING DELTA
PARTITIONED BY (DATE(event_time))
COMMENT 'Detailed timeline of session lifecycle events for analytics and debugging';

-- ========================================
-- LEGACY CLEANUP FROM PREVIOUS PHASES
-- ========================================

-- Remove obsolete columns from previous phase
ALTER TABLE classwaves.sessions.student_groups DROP COLUMN IF EXISTS participation_balance;

-- Add existing group analytics columns if not present
ALTER TABLE classwaves.sessions.student_groups ADD COLUMN IF NOT EXISTS conceptual_density DECIMAL(5,2) COMMENT 'Lexical richness and concept sophistication of the group discussion.';
ALTER TABLE classwaves.sessions.student_groups ADD COLUMN IF NOT EXISTS topical_cohesion DECIMAL(5,2) COMMENT 'Metric indicating how focused the group discussion is.';
ALTER TABLE classwaves.sessions.student_groups ADD COLUMN IF NOT EXISTS argumentation_quality DECIMAL(5,2) COMMENT 'Score representing the quality of arguments, evidence, and reasoning.';
ALTER TABLE classwaves.sessions.student_groups ADD COLUMN IF NOT EXISTS sentiment_arc STRING COMMENT 'JSON string representing the trend of the group sentiment over time.';

-- Remove aggregated individual metrics from sessions table
ALTER TABLE classwaves.sessions.classroom_sessions DROP COLUMN IF EXISTS participation_rate;
ALTER TABLE classwaves.sessions.classroom_sessions DROP COLUMN IF EXISTS engagement_score;

-- Ensure transcriptions table is group-centric
ALTER TABLE classwaves.sessions.transcriptions DROP COLUMN IF EXISTS participant_id;
ALTER TABLE classwaves.sessions.transcriptions DROP COLUMN IF EXISTS student_id;

-- Drop obsolete participants table if it exists
DROP TABLE IF EXISTS classwaves.sessions.participants;

SELECT 'Phase 5 schema migration completed successfully.' AS status;

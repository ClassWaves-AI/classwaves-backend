-- Synthetic seed data for local Postgres development.
SET client_min_messages TO WARNING;

-- Teacher
INSERT INTO users.teachers (id, email, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'teacher@example.com', 'Dev Teacher')
ON CONFLICT (id) DO NOTHING;

-- Session
INSERT INTO sessions.classroom_sessions (id, title, status, goal, subject, teacher_id)
VALUES (
  '00000000-0000-0000-0000-000000010000',
  'Dev Session',
  'active',
  'Explore energy transfer in everyday objects',
  'science',
  '00000000-0000-0000-0000-000000000001'
) ON CONFLICT (id) DO NOTHING;

-- Groups
INSERT INTO sessions.student_groups (id, session_id, name, group_number, status, max_size, current_size)
VALUES
  ('00000000-0000-0000-0000-000000020000','00000000-0000-0000-0000-000000010000','Group A',1,'active',4,3),
  ('00000000-0000-0000-0000-000000020001','00000000-0000-0000-0000-000000010000','Group B',2,'active',4,2)
ON CONFLICT (id) DO NOTHING;

-- Students
INSERT INTO users.students (id, name)
VALUES
  ('00000000-0000-0000-0000-000000030000','Student One'),
  ('00000000-0000-0000-0000-000000030001','Student Two'),
  ('00000000-0000-0000-0000-000000030002','Student Three')
ON CONFLICT (id) DO NOTHING;

-- Group membership
INSERT INTO sessions.student_group_members (id, session_id, group_id, student_id, role)
VALUES
  ('00000000-0000-0000-0000-000000040000','00000000-0000-0000-0000-000000010000','00000000-0000-0000-0000-000000020000','00000000-0000-0000-0000-000000030000','member'),
  ('00000000-0000-0000-0000-000000040001','00000000-0000-0000-0000-000000010000','00000000-0000-0000-0000-000000020000','00000000-0000-0000-0000-000000030001','member'),
  ('00000000-0000-0000-0000-000000040002','00000000-0000-0000-0000-000000010000','00000000-0000-0000-0000-000000020001','00000000-0000-0000-0000-000000030002','member')
ON CONFLICT (id) DO NOTHING;

-- Analytics event sample
INSERT INTO analytics.session_events (
  id, session_id, teacher_id, event_type, event_time, payload
) VALUES (
  '00000000-0000-0000-0000-000000070000',
  '00000000-0000-0000-0000-000000010000',
  '00000000-0000-0000-0000-000000000001',
  'session_started',
  now() - interval '5 minutes',
  '{"source":"local","notes":"Synthetic analytics event for dev"}'::jsonb
) ON CONFLICT (id) DO NOTHING;

-- Guidance prompt seed
INSERT INTO ai_insights.teacher_guidance_metrics (
  id,
  session_id,
  teacher_id,
  prompt_id,
  prompt_category,
  priority_level,
  prompt_message,
  group_id,
  generated_at,
  context_reason,
  context_prior_topic,
  context_current_topic,
  context_transition_idea,
  context_supporting_lines,
  context_confidence
) VALUES (
  '00000000-0000-0000-0000-000000050000',
  '00000000-0000-0000-0000-000000010000',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000060000',
  'redirection',
  'high',
  'Invite one student to connect their weekend example back to energy transfer.',
  '00000000-0000-0000-0000-000000020000',
  now() - interval '2 minutes',
  'Recent turns drifted into weekend plans instead of lab analysis.',
  'Analyzing lab results',
  'Weekend plans',
  'Ask for a concrete observation tied to the lab objective.',
  '[
    {"speaker":"student","quote":"We were talking about baseball this weekend.","timestamp":"2025-01-01T08:00:00.000Z"},
    {"speaker":"teacher","quote":"Let us connect it back to energy transfer.","timestamp":"2025-01-01T08:00:05.000Z"}
  ]'::jsonb,
  0.7
) ON CONFLICT (id) DO NOTHING;

-- Keep statistics fresh for first-run queries
ANALYZE;

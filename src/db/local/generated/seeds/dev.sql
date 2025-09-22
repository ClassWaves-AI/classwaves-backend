-- Synthetic seed data for local Postgres development.
SET client_min_messages TO WARNING;

-- School
INSERT INTO users.schools (id, name, domain)
VALUES ('11111111-1111-1111-1111-111111111111', 'Dev School', 'devschool.local')
ON CONFLICT (id) DO NOTHING;

-- Teacher
INSERT INTO users.teachers (id, email, name, school_id, role, status)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'rob@classwaves.ai',
  'Dev Super Admin',
  '11111111-1111-1111-1111-111111111111',
  'super_admin',
  'active'
)
ON CONFLICT (id) DO NOTHING;

-- Session
INSERT INTO sessions.classroom_sessions (id, title, status, goal, subject, teacher_id, school_id)
VALUES (
  '00000000-0000-0000-0000-000000010000',
  'Dev Session',
  'active',
  'Explore energy transfer in everyday objects',
  'science',
  '00000000-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111'
) ON CONFLICT (id) DO NOTHING;

-- Groups
INSERT INTO sessions.student_groups (id, session_id, name, group_number, status, max_size, current_size)
VALUES
  ('00000000-0000-0000-0000-000000020000','00000000-0000-0000-0000-000000010000','Group A',1,'active',4,3),
  ('00000000-0000-0000-0000-000000020001','00000000-0000-0000-0000-000000010000','Group B',2,'active',4,2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO users.students (
  id,
  school_id,
  display_name,
  preferred_name,
  given_name,
  family_name,
  grade_level,
  status,
  has_parental_consent,
  consent_date,
  parent_email,
  email_consent,
  coppa_compliant,
  teacher_verified_age,
  data_sharing_consent,
  audio_recording_consent,
  email
)
VALUES
  (
    '00000000-0000-0000-0000-000000030000',
    '11111111-1111-1111-1111-111111111111',
    'Student One',
    'Student One',
    'Student',
    'One',
    '9th',
    'active',
    true,
    now(),
    'guardian.one@devschool.local',
    true,
    true,
    true,
    true,
    true,
    'student.one@classwaves.example'
  ),
  (
    '00000000-0000-0000-0000-000000030001',
    '11111111-1111-1111-1111-111111111111',
    'Student Two',
    'Student Two',
    'Student',
    'Two',
    '10th',
    'active',
    true,
    now(),
    'guardian.two@devschool.local',
    true,
    true,
    true,
    true,
    true,
    'student.two@classwaves.example'
  ),
  (
    '00000000-0000-0000-0000-000000030002',
    '11111111-1111-1111-1111-111111111111',
    'Student Three',
    'Student Three',
    'Student',
    'Three',
    '11th',
    'active',
    true,
    now(),
    'guardian.three@devschool.local',
    true,
    true,
    true,
    true,
    true,
    'student.three@classwaves.example'
  )
ON CONFLICT (id) DO NOTHING;

-- Group membership
INSERT INTO sessions.student_group_members (id, session_id, group_id, student_id)
VALUES
  ('00000000-0000-0000-0000-000000040000','00000000-0000-0000-0000-000000010000','00000000-0000-0000-0000-000000020000','00000000-0000-0000-0000-000000030000'),
  ('00000000-0000-0000-0000-000000040001','00000000-0000-0000-0000-000000010000','00000000-0000-0000-0000-000000020000','00000000-0000-0000-0000-000000030001'),
  ('00000000-0000-0000-0000-000000040002','00000000-0000-0000-0000-000000010000','00000000-0000-0000-0000-000000020001','00000000-0000-0000-0000-000000030002')
ON CONFLICT (id) DO NOTHING;

-- Analytics event sample
INSERT INTO analytics.session_events (
  id,
  session_id,
  teacher_id,
  created_at,
  updated_at,
  event_time,
  event_type,
  payload
) VALUES (
  '00000000-0000-0000-0000-000000070000',
  '00000000-0000-0000-0000-000000010000',
  '00000000-0000-0000-0000-000000000001',
  now(),
  now(),
  now() - interval '5 minutes',
  'session_started',
  '{"source":"local","notes":"Synthetic analytics event for dev"}'::jsonb
) ON CONFLICT (id) DO NOTHING;

-- Guidance prompt seed
INSERT INTO ai_insights.teacher_guidance_metrics (
  id,
  session_id,
  teacher_id,
  prompt_id,
  prompt_category
) VALUES (
  '00000000-0000-0000-0000-000000050000',
  '00000000-0000-0000-0000-000000010000',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000060000',
  'redirection'
) ON CONFLICT (id) DO NOTHING;

-- Keep statistics fresh for first-run queries
ANALYZE;

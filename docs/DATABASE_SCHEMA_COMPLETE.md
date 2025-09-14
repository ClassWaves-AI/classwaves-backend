# ClassWaves Database Schema Documentation

**Generated:** 2025-09-14T20:03:36.661Z
**Purpose:** Complete documentation of all database schemas, tables, and columns

## Overview

This document provides a comprehensive view of the ClassWaves database structure across all schemas.

**Total Tables:** 74
**Schemas:** admin, ai_insights, analytics, audio, communication, compliance, information_schema, notifications, operational, sessions, users

### Data Volume Summary

| Schema | Tables | Total Rows | Tables with Data | Last Activity |
|--------|--------|------------|------------------|---------------|
| `admin` | 2 | 1 | 1 | 2025-08-03 |
| `ai_insights` | 11 | 134 | 4 | 2025-09-14 |
| `analytics` | 10 | 493 | 6 | 2025-09-14 |
| `audio` | 1 | 0 | 0 | Unknown |
| `communication` | 1 | 0 | 0 | Unknown |
| `compliance` | 4 | 10,515 | 1 | 2025-09-03 |
| `information_schema` | 28 | 0 | 0 | Unknown |
| `notifications` | 2 | 15 | 1 | 2025-09-14 |
| `operational` | 3 | 907 | 1 | 2025-09-10 |
| `sessions` | 5 | 2,703 | 5 | 2025-09-14 |
| `users` | 7 | 465 | 4 | 2025-09-14 |


---

## Schema: `admin`

**Tables:** 2

### Table: `districts`

**Full Name:** `classwaves.admin.districts`
**Columns:** 16
**Row Count:** 1
**Last Updated:** 2025-08-03

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `name` | `string` | ✅ |  |
| `state` | `string` | ✅ |  |
| `region` | `string` | ✅ |  |
| `superintendent_name` | `string` | ✅ |  |
| `contact_email` | `string` | ✅ |  |
| `contact_phone` | `string` | ✅ |  |
| `website` | `string` | ✅ |  |
| `student_count` | `int` | ✅ |  |
| `school_count` | `int` | ✅ |  |
| `teacher_count` | `int` | ✅ |  |
| `subscription_tier` | `string` | ✅ |  |
| `contract_details` | `map<string,string>` | ✅ |  |
| `is_active` | `boolean` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |
| `updated_at` | `timestamp` | ✅ |  |

### Table: `school_settings`

**Full Name:** `classwaves.admin.school_settings`
**Columns:** 9
**Row Count:** 0

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `school_id` | `string` | ✅ |  |
| `setting_key` | `string` | ✅ |  |
| `setting_value` | `string` | ✅ |  |
| `setting_type` | `string` | ✅ |  |
| `description` | `string` | ✅ |  |
| `is_editable` | `boolean` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |
| `updated_at` | `timestamp` | ✅ |  |

---

## Schema: `ai_insights`

**Tables:** 11

### Table: `analysis_results`

**Full Name:** `classwaves.ai_insights.analysis_results`
**Columns:** 9
**Row Count:** 6
**Last Updated:** 2025-09-10

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `session_id` | `string` | ✅ |  |
| `analysis_type` | `string` | ✅ |  |
| `analysis_timestamp` | `timestamp` | ✅ |  |
| `processing_time_ms` | `int` | ✅ |  |
| `result_data` | `string` | ✅ |  |
| `confidence_score` | `decimal(5,4)` | ✅ |  |
| `model_version` | `string` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |

### Table: `educational_insights`

**Full Name:** `classwaves.ai_insights.educational_insights`
**Columns:** 11
**Row Count:** 0

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `session_id` | `string` | ✅ |  |
| `insight_type` | `string` | ✅ |  |
| `title` | `string` | ✅ |  |
| `description` | `string` | ✅ |  |
| `recommendations` | `string` | ✅ |  |
| `impact_score` | `decimal(5,2)` | ✅ |  |
| `confidence_level` | `decimal(5,2)` | ✅ |  |
| `applies_to_type` | `string` | ✅ |  |
| `applies_to_id` | `string` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |

### Table: `group_summaries`

**Full Name:** `classwaves.ai_insights.group_summaries`
**Columns:** 6
**Row Count:** 5
**Last Updated:** 2025-09-10

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `session_id` | `string` | ✅ |  |
| `group_id` | `string` | ✅ |  |
| `summary_json` | `string` | ✅ |  |
| `analysis_timestamp` | `timestamp` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |

### Table: `guidance_events`

**Full Name:** `classwaves.ai_insights.guidance_events`
**Columns:** 8
**Row Count:** 0

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `session_id` | `string` | ✅ |  |
| `group_id` | `string` | ✅ |  |
| `teacher_id` | `string` | ✅ |  |
| `event_type` | `string` | ✅ |  |
| `payload` | `string` | ✅ |  |
| `event_timestamp` | `timestamp` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |

### Table: `intervention_suggestions`

**Full Name:** `classwaves.ai_insights.intervention_suggestions`
**Columns:** 15
**Row Count:** 0

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `session_id` | `string` | ✅ |  |
| `group_id` | `string` | ✅ |  |
| `teacher_id` | `string` | ✅ |  |
| `intervention_type` | `string` | ✅ |  |
| `urgency` | `string` | ✅ |  |
| `reason` | `string` | ✅ |  |
| `suggested_action` | `string` | ✅ |  |
| `target_type` | `string` | ✅ |  |
| `target_student_id` | `string` | ✅ |  |
| `status` | `string` | ✅ |  |
| `acted_upon` | `boolean` | ✅ |  |
| `acted_at` | `timestamp` | ✅ |  |
| `was_effective` | `boolean` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |

### Table: `session_guidance_analytics`

**Full Name:** `classwaves.ai_insights.session_guidance_analytics`
**Columns:** 40
**Row Count:** 0

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `session_id` | `string` | ✅ |  |
| `teacher_id` | `string` | ✅ |  |
| `school_id` | `string` | ✅ |  |
| `session_date` | `date` | ✅ |  |
| `subject_area` | `string` | ✅ |  |
| `session_duration_minutes` | `int` | ✅ |  |
| `total_groups` | `int` | ✅ |  |
| `total_students` | `int` | ✅ |  |
| `total_prompts_generated` | `int` | ✅ |  |
| `total_prompts_acknowledged` | `int` | ✅ |  |
| `total_prompts_used` | `int` | ✅ |  |
| `total_prompts_dismissed` | `int` | ✅ |  |
| `total_prompts_expired` | `int` | ✅ |  |
| `acknowledgment_rate` | `double` | ✅ |  |
| `usage_rate` | `double` | ✅ |  |
| `effectiveness_rate` | `double` | ✅ |  |
| `avg_feedback_rating` | `double` | ✅ |  |
| `avg_effectiveness_score` | `double` | ✅ |  |
| `avg_response_time_seconds` | `double` | ✅ |  |
| `session_improvement_score` | `double` | ✅ |  |
| `student_engagement_improvement` | `double` | ✅ |  |
| `discussion_quality_improvement` | `double` | ✅ |  |
| `learning_objective_completion_rate` | `double` | ✅ |  |
| `category_breakdown` | `map<string,struct<generated:int,used:int,effectiveness:double>>` | ✅ |  |
| `priority_breakdown` | `map<string,struct<generated:int,used:int,effectiveness:double>>` | ✅ |  |
| `phase_breakdown` | `map<string,struct<generated:int,used:int,effectiveness:double>>` | ✅ |  |
| `teacher_satisfaction_rating` | `int` | ✅ |  |
| `teacher_feedback_text` | `string` | ✅ |  |
| `would_recommend_system` | `boolean` | ✅ |  |
| `ai_analysis_latency_ms` | `double` | ✅ |  |
| `prompt_generation_latency_ms` | `double` | ✅ |  |
| `system_uptime_percentage` | `double` | ✅ |  |
| `error_count` | `int` | ✅ |  |
| `compliance_violations` | `int` | ✅ |  |
| `data_retention_compliance` | `boolean` | ✅ |  |
| `privacy_safeguards_applied` | `boolean` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |
| `updated_at` | `timestamp` | ✅ |  |
| `session_date` | `date` | ✅ |  |

### Table: `session_summaries`

**Full Name:** `classwaves.ai_insights.session_summaries`
**Columns:** 5
**Row Count:** 5
**Last Updated:** 2025-09-10

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `session_id` | `string` | ✅ |  |
| `summary_json` | `string` | ✅ |  |
| `analysis_timestamp` | `timestamp` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |

### Table: `teacher_guidance_metrics`

**Full Name:** `classwaves.ai_insights.teacher_guidance_metrics`
**Columns:** 29
**Row Count:** 118
**Last Updated:** 2025-09-14

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ | Unique identifier for the guidance metric record |
| `session_id` | `string` | ✅ | Reference to the classroom session |
| `teacher_id` | `string` | ✅ | Reference to the teacher user |
| `prompt_id` | `string` | ✅ | Unique identifier for the specific prompt |
| `prompt_category` | `string` | ✅ | facilitation, deepening, redirection, collaboration,
assessment, energy, clarity |
| `priority_level` | `string` | ✅ | high, medium, low |
| `prompt_message` | `string` | ✅ | The actual prompt text shown to teacher |
| `prompt_context` | `string` | ✅ | Context that triggered the prompt |
| `suggested_timing` | `string` | ✅ | immediate, next_break, session_end |
| `session_phase` | `string` | ✅ | opening, development, synthesis, closure |
| `subject_area` | `string` | ✅ | math, science, literature, history, general |
| `target_metric` | `string` | ✅ | AI metric that triggered this prompt |
| `learning_objectives` | `string` | ✅ | JSON-encoded array of objectives |
| `group_id` | `string` | ✅ | Target group for the prompt (if group-specific) |
| `generated_at` | `timestamp` | ✅ | When the prompt was generated |
| `acknowledged_at` | `timestamp` | ✅ | When teacher acknowledged seeing the prompt |
| `used_at` | `timestamp` | ✅ | When teacher acted on the prompt |
| `dismissed_at` | `timestamp` | ✅ | When teacher explicitly dismissed the prompt |
| `expires_at` | `timestamp` | ✅ | When the prompt expires |
| `feedback_rating` | `int` | ✅ | Teacher feedback rating 1-5 |
| `feedback_text` | `string` | ✅ | Teacher feedback text |
| `effectiveness_score` | `double` | ✅ | System-calculated effectiveness score |
| `learning_outcome_improvement` | `double` | ✅ | Measured impact on learning outcomes |
| `response_time_seconds` | `int` | ✅ | Seconds from generation to first interaction |
| `educational_purpose` | `string` | ✅ | Educational justification |
| `compliance_basis` | `string` | ✅ | Legal basis for data processing |
| `data_retention_date` | `date` | ✅ | When this record should be purged |
| `created_at` | `timestamp` | ✅ | Record creation timestamp |
| `updated_at` | `timestamp` | ✅ | Last update timestamp |

### Table: `teacher_prompt_effectiveness`

**Full Name:** `classwaves.ai_insights.teacher_prompt_effectiveness`
**Columns:** 26
**Row Count:** 0

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `prompt_category` | `string` | ✅ |  |
| `subject_area` | `string` | ✅ |  |
| `session_phase` | `string` | ✅ |  |
| `priority_level` | `string` | ✅ |  |
| `total_generated` | `int` | ✅ |  |
| `total_acknowledged` | `int` | ✅ |  |
| `total_used` | `int` | ✅ |  |
| `total_dismissed` | `int` | ✅ |  |
| `acknowledgment_rate` | `double` | ✅ |  |
| `usage_rate` | `double` | ✅ |  |
| `dismissal_rate` | `double` | ✅ |  |
| `avg_effectiveness_score` | `double` | ✅ |  |
| `avg_feedback_rating` | `double` | ✅ |  |
| `avg_response_time_seconds` | `double` | ✅ |  |
| `avg_learning_impact` | `double` | ✅ |  |
| `std_dev_effectiveness` | `double` | ✅ |  |
| `confidence_interval_lower` | `double` | ✅ |  |
| `confidence_interval_upper` | `double` | ✅ |  |
| `data_points` | `int` | ✅ |  |
| `calculation_period_start` | `timestamp` | ✅ |  |
| `calculation_period_end` | `timestamp` | ✅ |  |
| `last_calculated` | `timestamp` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |
| `updated_at` | `timestamp` | ✅ |  |
| `subject_area` | `string` | ✅ |  |

### Table: `tier1_analysis`

**Full Name:** `classwaves.ai_insights.tier1_analysis`
**Columns:** 6
**Row Count:** 0

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `session_id` | `string` | ✅ |  |
| `group_id` | `string` | ✅ |  |
| `insights` | `string` | ✅ |  |
| `analysis_timestamp` | `timestamp` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |

### Table: `tier2_analysis`

**Full Name:** `classwaves.ai_insights.tier2_analysis`
**Columns:** 5
**Row Count:** 0

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `session_id` | `string` | ✅ |  |
| `insights` | `string` | ✅ |  |
| `analysis_timestamp` | `timestamp` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |

---

## Schema: `analytics`

**Tables:** 10

### Table: `dashboard_metrics_hourly`

**Full Name:** `classwaves.analytics.dashboard_metrics_hourly`
**Columns:** 34
**Row Count:** 15
**Last Updated:** 2025-08-12

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ | Unique identifier for hourly metric record |
| `school_id` | `string` | ✅ | School identifier for data isolation |
| `metric_hour` | `timestamp` | ✅ | Hour of aggregated metrics (e.g., 2024-01-15 14:00:00) |
| `sessions_active` | `int` | ✅ | Number of active sessions during this hour |
| `sessions_completed` | `int` | ✅ | Number of sessions completed during this hour |
| `teachers_active` | `int` | ✅ | Number of unique teachers active during this hour |
| `students_active` | `int` | ✅ | Number of unique students active during this hour |
| `total_groups` | `int` | ✅ | Total number of groups active during this hour |
| `ready_groups` | `int` | ✅ | Number of groups that were ready during this hour |
| `avg_session_quality` | `double` | ✅ | Average session quality score for the hour |
| `avg_engagement_score` | `double` | ✅ | Average student engagement score for the hour |
| `avg_participation_rate` | `double` | ✅ | Average student participation rate for the hour |
| `avg_collaboration_score` | `double` | ✅ | Average collaboration effectiveness for the hour |
| `avg_audio_quality` | `double` | ✅ | Average audio quality score for the hour |
| `avg_connection_stability` | `double` | ✅ | Average connection stability for the hour |
| `total_errors` | `int` | ✅ | Total system errors during this hour |
| `avg_response_time` | `double` | ✅ | Average system response time in milliseconds |
| `websocket_connections` | `int` | ✅ | Peak concurrent websocket connections |
| `avg_latency_ms` | `double` | ✅ | Average network latency in milliseconds |
| `error_rate` | `double` | ✅ | Error rate as percentage (0.0-100.0) |
| `total_prompts_generated` | `int` | ✅ | Total AI prompts generated during this hour |
| `total_prompts_used` | `int` | ✅ | Total prompts acted upon by teachers |
| `total_interventions` | `int` | ✅ | Total teacher interventions during this hour |
| `total_alerts` | `int` | ✅ | Total system alerts generated during this hour |
| `ai_analyses_completed` | `int` | ✅ | Number of AI analyses completed during this hour |
| `avg_ai_processing_time` | `double` | ✅ | Average AI processing time in milliseconds |
| `ai_analysis_success_rate` | `double` | ✅ | AI analysis success rate as percentage |
| `total_transcription_minutes` | `double` | ✅ | Total minutes of transcription processed |
| `total_storage_gb` | `double` | ✅ | Total storage used in gigabytes |
| `estimated_compute_cost` | `double` | ✅ | Estimated compute cost for this hour |
| `data_sources_count` | `int` | ✅ | Number of source records aggregated |
| `calculation_method` | `string` | ✅ | Method used for aggregation (hourly_rollup) |
| `calculated_at` | `timestamp` | ✅ | When this aggregation was calculated |
| `created_at` | `timestamp` | ✅ | Record creation timestamp |

### Table: `educational_metrics`

**Full Name:** `classwaves.analytics.educational_metrics`
**Columns:** 9
**Row Count:** 2
**Last Updated:** 2025-08-12

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `session_id` | `string` | ✅ |  |
| `metric_type` | `string` | ✅ |  |
| `metric_name` | `string` | ✅ |  |
| `metric_value` | `decimal(10,4)` | ✅ |  |
| `metric_metadata` | `map<string,string>` | ✅ |  |
| `aggregation_level` | `string` | ✅ |  |
| `calculation_timestamp` | `timestamp` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |

### Table: `group_analytics`

**Full Name:** `classwaves.analytics.group_analytics`
**Columns:** 14
**Row Count:** 0

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `group_id` | `string` | ✅ |  |
| `session_id` | `string` | ✅ |  |
| `analysis_type` | `string` | ✅ |  |
| `member_count` | `int` | ✅ |  |
| `completion_rate` | `decimal(5,2)` | ✅ |  |
| `engagement_score` | `decimal(5,2)` | ✅ |  |
| `participation_rate` | `decimal(5,2)` | ✅ |  |
| `avg_collaboration_time` | `decimal(10,2)` | ✅ |  |
| `total_messages` | `int` | ✅ |  |
| `avg_message_length` | `decimal(8,2)` | ✅ |  |
| `leader_engagement_score` | `decimal(5,2)` | ✅ |  |
| `computed_at` | `timestamp` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |
| `updated_at` | `timestamp` | ✅ |  |

### Table: `group_metrics`

**Full Name:** `classwaves.analytics.group_metrics`
**Columns:** 23
**Row Count:** 0

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `group_id` | `string` | ✅ |  |
| `session_id` | `string` | ✅ |  |
| `calculation_timestamp` | `timestamp` | ✅ |  |
| `participation_equality_index` | `decimal(5,4)` | ✅ |  |
| `dominant_speaker_percentage` | `decimal(5,2)` | ✅ |  |
| `silent_members_count` | `int` | ✅ |  |
| `turn_taking_score` | `decimal(5,2)` | ✅ |  |
| `interruption_rate` | `decimal(5,2)` | ✅ |  |
| `supportive_interactions_count` | `int` | ✅ |  |
| `topic_coherence_score` | `decimal(5,2)` | ✅ |  |
| `vocabulary_diversity_score` | `decimal(5,2)` | ✅ |  |
| `academic_discourse_score` | `decimal(5,2)` | ✅ |  |
| `average_sentiment_score` | `decimal(5,2)` | ✅ |  |
| `emotional_support_instances` | `int` | ✅ |  |
| `conflict_instances` | `int` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |
| `configured_name` | `string` | ✅ | Teacher-assigned group name |
| `configured_size` | `int` | ✅ | Number of members assigned to group |
| `leader_assigned` | `boolean` | ✅ | Whether a leader was assigned to this group |
| `leader_ready_at` | `timestamp` | ✅ | When group leader marked ready |
| `members_configured` | `int` | ✅ | Number of members configured for group |
| `members_present` | `int` | ✅ | Number of configured members actually present |

### Table: `session_analytics`

**Full Name:** `classwaves.analytics.session_analytics`
**Columns:** 15
**Row Count:** 131
**Last Updated:** 2025-09-04

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `session_id` | `string` | ✅ |  |
| `analysis_type` | `string` | ✅ |  |
| `status` | `string` | ✅ |  |
| `computation_id` | `string` | ✅ |  |
| `analytics_data` | `string` | ✅ |  |
| `computation_metadata` | `string` | ✅ |  |
| `started_at` | `timestamp` | ✅ |  |
| `computed_at` | `timestamp` | ✅ |  |
| `failed_at` | `timestamp` | ✅ |  |
| `error_message` | `string` | ✅ |  |
| `version` | `string` | ✅ |  |
| `processing_time_ms` | `bigint` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |
| `updated_at` | `timestamp` | ✅ |  |

### Table: `session_analytics_cache`

**Full Name:** `classwaves.analytics.session_analytics_cache`
**Columns:** 25
**Row Count:** 22
**Last Updated:** 2025-09-04

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `session_id` | `string` | ✅ |  |
| `teacher_id` | `string` | ✅ |  |
| `school_id` | `string` | ✅ |  |
| `session_date` | `date` | ✅ |  |
| `session_status` | `string` | ✅ |  |
| `planned_groups` | `int` | ✅ |  |
| `actual_groups` | `int` | ✅ |  |
| `planned_duration_minutes` | `int` | ✅ |  |
| `actual_duration_minutes` | `int` | ✅ |  |
| `total_students` | `int` | ✅ |  |
| `active_students` | `int` | ✅ |  |
| `avg_participation_rate` | `double` | ✅ |  |
| `ready_groups_at_start` | `int` | ✅ |  |
| `ready_groups_at_5m` | `int` | ✅ |  |
| `ready_groups_at_10m` | `int` | ✅ |  |
| `avg_group_readiness_time` | `double` | ✅ |  |
| `total_transcriptions` | `int` | ✅ |  |
| `avg_engagement_score` | `double` | ✅ |  |
| `avg_collaboration_score` | `double` | ✅ |  |
| `cache_key` | `string` | ✅ |  |
| `expires_at` | `timestamp` | ✅ |  |
| `last_updated` | `timestamp` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |
| `session_date` | `date` | ✅ |  |

### Table: `session_events`

**Full Name:** `classwaves.analytics.session_events`
**Columns:** 7
**Row Count:** 279
**Last Updated:** 2025-09-14

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ | Unique event identifier |
| `session_id` | `string` | ✅ | Session this event belongs to (FK to classroom_sessions) |
| `teacher_id` | `string` | ✅ | Teacher who owns the session (FK to teachers) |
| `event_type` | `string` | ✅ | Event type: configured|started|leader_ready|member_join|member_leave|ended |
| `event_time` | `timestamp` | ✅ | When the event occurred (UTC timestamp) |
| `payload` | `string` | ✅ | JSON string with event-specific data (groupId, counts, member info, etc.) |
| `created_at` | `timestamp` | ✅ | Record creation timestamp |

### Table: `session_metrics`

**Full Name:** `classwaves.analytics.session_metrics`
**Columns:** 34
**Row Count:** 44
**Last Updated:** 2025-09-14

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `session_id` | `string` | ✅ |  |
| `calculation_timestamp` | `timestamp` | ✅ |  |
| `total_students` | `int` | ✅ |  |
| `active_students` | `int` | ✅ |  |
| `participation_rate` | `decimal(5,2)` | ✅ |  |
| `average_speaking_time_seconds` | `decimal(10,2)` | ✅ |  |
| `speaking_time_std_dev` | `decimal(10,2)` | ✅ |  |
| `overall_engagement_score` | `decimal(5,2)` | ✅ |  |
| `attention_score` | `decimal(5,2)` | ✅ |  |
| `interaction_score` | `decimal(5,2)` | ✅ |  |
| `collaboration_score` | `decimal(5,2)` | ✅ |  |
| `on_topic_percentage` | `decimal(5,2)` | ✅ |  |
| `academic_vocabulary_usage` | `decimal(5,2)` | ✅ |  |
| `question_asking_rate` | `decimal(5,2)` | ✅ |  |
| `group_formation_time_seconds` | `int` | ✅ |  |
| `average_group_size` | `decimal(5,2)` | ✅ |  |
| `group_stability_score` | `decimal(5,2)` | ✅ |  |
| `average_connection_quality` | `decimal(5,2)` | ✅ |  |
| `technical_issues_count` | `int` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |
| `planned_groups` | `int` | ✅ | Number of groups configured by teacher |
| `planned_group_size` | `int` | ✅ | Target group size configured by teacher |
| `planned_duration_minutes` | `int` | ✅ | Planned session duration in minutes |
| `planned_members` | `int` | ✅ | Total members planned across all groups |
| `planned_leaders` | `int` | ✅ | Number of group leaders assigned |
| `planned_scheduled_start` | `timestamp` | ✅ | Teacher-scheduled start time |
| `configured_at` | `timestamp` | ✅ | When session was fully configured |
| `started_at` | `timestamp` | ✅ | When session was actually started |
| `started_without_ready_groups` | `boolean` | ✅ | Whether session started before all groups were ready |
| `ready_groups_at_start` | `int` | ✅ | Number of groups marked ready when session started |
| `ready_groups_at_5m` | `int` | ✅ | Number of groups ready at 5 minutes |
| `ready_groups_at_10m` | `int` | ✅ | Number of groups ready at 10 minutes |
| `adherence_members_ratio` | `double` | ✅ | Ratio of actual to planned member participation |

### Table: `student_metrics`

**Full Name:** `classwaves.analytics.student_metrics`
**Columns:** 20
**Row Count:** 0

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `participant_id` | `string` | ✅ |  |
| `session_id` | `string` | ✅ |  |
| `calculation_timestamp` | `timestamp` | ✅ |  |
| `total_speaking_time_seconds` | `int` | ✅ |  |
| `speaking_turns_count` | `int` | ✅ |  |
| `average_turn_duration_seconds` | `decimal(10,2)` | ✅ |  |
| `participation_score` | `decimal(5,2)` | ✅ |  |
| `initiative_score` | `decimal(5,2)` | ✅ |  |
| `responsiveness_score` | `decimal(5,2)` | ✅ |  |
| `vocabulary_complexity_score` | `decimal(5,2)` | ✅ |  |
| `grammar_accuracy_score` | `decimal(5,2)` | ✅ |  |
| `fluency_score` | `decimal(5,2)` | ✅ |  |
| `peer_interaction_count` | `int` | ✅ |  |
| `supportive_comments_count` | `int` | ✅ |  |
| `questions_asked_count` | `int` | ✅ |  |
| `average_sentiment` | `decimal(5,2)` | ✅ |  |
| `confidence_level` | `decimal(5,2)` | ✅ |  |
| `stress_indicators_count` | `int` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |

### Table: `teacher_analytics_summary`

**Full Name:** `classwaves.analytics.teacher_analytics_summary`
**Columns:** 26
**Row Count:** 0

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `teacher_id` | `string` | ✅ |  |
| `school_id` | `string` | ✅ |  |
| `summary_date` | `date` | ✅ |  |
| `total_sessions` | `int` | ✅ |  |
| `avg_session_score` | `double` | ✅ |  |
| `avg_effectiveness_score` | `double` | ✅ |  |
| `avg_participation_rate` | `double` | ✅ |  |
| `total_session_duration_minutes` | `int` | ✅ |  |
| `total_prompts_shown` | `int` | ✅ |  |
| `total_prompts_used` | `int` | ✅ |  |
| `total_prompts_dismissed` | `int` | ✅ |  |
| `prompt_usage_rate` | `double` | ✅ |  |
| `avg_prompt_response_time` | `double` | ✅ |  |
| `avg_engagement_score` | `double` | ✅ |  |
| `avg_collaboration_score` | `double` | ✅ |  |
| `avg_critical_thinking_score` | `double` | ✅ |  |
| `avg_discussion_quality_score` | `double` | ✅ |  |
| `confidence_score` | `double` | ✅ |  |
| `data_quality_score` | `double` | ✅ |  |
| `calculation_method` | `string` | ✅ |  |
| `source_tables` | `string` | ✅ |  |
| `calculated_at` | `timestamp` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |
| `updated_at` | `timestamp` | ✅ |  |
| `summary_date` | `date` | ✅ |  |

---

## Schema: `audio`

**Tables:** 1

### Table: `recordings`

**Full Name:** `classwaves.audio.recordings`
**Columns:** 17
**Row Count:** 0

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `session_id` | `string` | ✅ |  |
| `group_id` | `string` | ✅ |  |
| `participant_id` | `string` | ✅ |  |
| `file_path` | `string` | ✅ |  |
| `file_size_bytes` | `bigint` | ✅ |  |
| `duration_seconds` | `int` | ✅ |  |
| `format` | `string` | ✅ |  |
| `sample_rate` | `int` | ✅ |  |
| `channels` | `int` | ✅ |  |
| `codec` | `string` | ✅ |  |
| `is_processed` | `boolean` | ✅ |  |
| `transcription_status` | `string` | ✅ |  |
| `processing_attempts` | `int` | ✅ |  |
| `last_error` | `string` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |
| `processed_at` | `timestamp` | ✅ |  |

---

## Schema: `communication`

**Tables:** 1

### Table: `messages`

**Full Name:** `classwaves.communication.messages`
**Columns:** 16
**Row Count:** 0

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `session_id` | `string` | ✅ |  |
| `sender_id` | `string` | ✅ |  |
| `sender_type` | `string` | ✅ |  |
| `recipient_id` | `string` | ✅ |  |
| `recipient_type` | `string` | ✅ |  |
| `message_type` | `string` | ✅ |  |
| `subject` | `string` | ✅ |  |
| `content` | `string` | ✅ |  |
| `metadata` | `map<string,string>` | ✅ |  |
| `is_read` | `boolean` | ✅ |  |
| `is_archived` | `boolean` | ✅ |  |
| `is_deleted` | `boolean` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |
| `read_at` | `timestamp` | ✅ |  |
| `deleted_at` | `timestamp` | ✅ |  |

---

## Schema: `compliance`

**Tables:** 4

### Table: `audit_log`

**Full Name:** `classwaves.compliance.audit_log`
**Columns:** 17
**Row Count:** 10,515
**Last Updated:** 2025-09-03

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `actor_id` | `string` | ✅ |  |
| `actor_type` | `string` | ✅ |  |
| `event_type` | `string` | ✅ |  |
| `event_category` | `string` | ✅ |  |
| `event_timestamp` | `timestamp` | ✅ |  |
| `resource_type` | `string` | ✅ |  |
| `resource_id` | `string` | ✅ |  |
| `school_id` | `string` | ✅ |  |
| `session_id` | `string` | ✅ |  |
| `description` | `string` | ✅ |  |
| `ip_address` | `string` | ✅ |  |
| `user_agent` | `string` | ✅ |  |
| `compliance_basis` | `string` | ✅ |  |
| `data_accessed` | `string` | ✅ |  |
| `affected_student_ids` | `string` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |

### Table: `coppa_compliance`

**Full Name:** `classwaves.compliance.coppa_compliance`
**Columns:** 18
**Row Count:** 0

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `student_id` | `string` | ✅ |  |
| `school_id` | `string` | ✅ |  |
| `birth_year` | `int` | ✅ |  |
| `is_under_13` | `boolean` | ✅ |  |
| `age_verification_method` | `string` | ✅ |  |
| `age_verified_at` | `timestamp` | ✅ |  |
| `data_collection_limited` | `boolean` | ✅ |  |
| `no_behavioral_targeting` | `boolean` | ✅ |  |
| `no_third_party_sharing` | `boolean` | ✅ |  |
| `auto_delete_enabled` | `boolean` | ✅ |  |
| `delete_after_days` | `int` | ✅ |  |
| `deletion_requested_at` | `timestamp` | ✅ |  |
| `deletion_completed_at` | `timestamp` | ✅ |  |
| `parent_access_enabled` | `boolean` | ✅ |  |
| `parent_last_reviewed` | `timestamp` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |
| `updated_at` | `timestamp` | ✅ |  |

### Table: `parental_consents`

**Full Name:** `classwaves.compliance.parental_consents`
**Columns:** 19
**Row Count:** 0

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `student_id` | `string` | ✅ |  |
| `school_id` | `string` | ✅ |  |
| `consent_type` | `string` | ✅ |  |
| `consent_given` | `boolean` | ✅ |  |
| `consent_date` | `timestamp` | ✅ |  |
| `parent_name` | `string` | ✅ |  |
| `parent_email` | `string` | ✅ |  |
| `relationship` | `string` | ✅ |  |
| `verification_method` | `string` | ✅ |  |
| `verification_token` | `string` | ✅ |  |
| `verified_at` | `timestamp` | ✅ |  |
| `ip_address` | `string` | ✅ |  |
| `user_agent` | `string` | ✅ |  |
| `consent_text_version` | `string` | ✅ |  |
| `expires_at` | `timestamp` | ✅ |  |
| `revoked_at` | `timestamp` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |
| `updated_at` | `timestamp` | ✅ |  |

### Table: `retention_policies`

**Full Name:** `classwaves.compliance.retention_policies`
**Columns:** 10
**Row Count:** 0

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `school_id` | `string` | ✅ |  |
| `policy_type` | `string` | ✅ |  |
| `retention_days` | `int` | ✅ |  |
| `delete_after_days` | `int` | ✅ |  |
| `archive_after_days` | `int` | ✅ |  |
| `legal_basis` | `string` | ✅ |  |
| `auto_delete_enabled` | `boolean` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |
| `updated_at` | `timestamp` | ✅ |  |

---

## Schema: `information_schema`

**Tables:** 28

### Table: `catalog_privileges`

**Full Name:** `classwaves.information_schema.catalog_privileges`
**Columns:** 6

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `grantor` | `string` | ✅ | Principal that granted the privilege. |
| `grantee` | `string` | ✅ | Principal to which the privilege is granted. |
| `catalog_name` | `string` | ✅ | Catalog on which the privilege is granted. |
| `privilege_type` | `string` | ✅ | Privilege being granted. |
| `is_grantable` | `string` | ✅ | Always NO. Reserved for future use. |
| `inherited_from` | `string` | ✅ | The ancestor relation that the privilege is inherited from. |

### Table: `catalog_tags`

**Full Name:** `classwaves.information_schema.catalog_tags`
**Columns:** 3

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `catalog_name` | `string` | ✅ |  |
| `tag_name` | `string` | ✅ |  |
| `tag_value` | `string` | ✅ |  |

### Table: `catalogs`

**Full Name:** `classwaves.information_schema.catalogs`
**Columns:** 7

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `catalog_name` | `string` | ✅ | Name of the catalog. |
| `catalog_owner` | `string` | ✅ | Owner of the catalog. |
| `comment` | `string` | ✅ | An optional comment that describes the catalog. |
| `created` | `timestamp` | ✅ | Timestamp when the catalog was created. |
| `created_by` | `string` | ✅ | Principal who created the catalog. |
| `last_altered` | `timestamp` | ✅ | Timestamp when the catalog was last altered in any way. |
| `last_altered_by` | `string` | ✅ | Principal who last altered the catalog. |

### Table: `check_constraints`

**Full Name:** `classwaves.information_schema.check_constraints`
**Columns:** 6

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `constraint_catalog` | `string` | ✅ | Catalog containing the check constraint. |
| `constraint_schema` | `string` | ✅ | Schema containing the check constraint. |
| `constraint_name` | `string` | ✅ | Name of the check constraint. |
| `check_clause` | `string` | ✅ | The text of the check constraint condition. |
| `sql_path` | `string` | ✅ | Always NULL, reserved for future use. |
| `comment` | `string` | ✅ |  |

### Table: `column_masks`

**Full Name:** `classwaves.information_schema.column_masks`
**Columns:** 6

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `table_catalog` | `string` | ✅ |  |
| `table_schema` | `string` | ✅ |  |
| `table_name` | `string` | ✅ |  |
| `column_name` | `string` | ✅ |  |
| `mask_name` | `string` | ✅ |  |
| `using_columns` | `string` | ✅ |  |

### Table: `column_tags`

**Full Name:** `classwaves.information_schema.column_tags`
**Columns:** 6

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `catalog_name` | `string` | ✅ |  |
| `schema_name` | `string` | ✅ |  |
| `table_name` | `string` | ✅ |  |
| `column_name` | `string` | ✅ |  |
| `tag_name` | `string` | ✅ |  |
| `tag_value` | `string` | ✅ |  |

### Table: `columns`

**Full Name:** `classwaves.information_schema.columns`
**Columns:** 33

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `table_catalog` | `string` | ✅ | Catalog that contains the relation. |
| `table_schema` | `string` | ✅ | Schema that contains the relation. |
| `table_name` | `string` | ✅ | Name of the relation the column is part of. |
| `column_name` | `string` | ✅ | Name of the column. |
| `ordinal_position` | `int` | ✅ | The position (numbered from 1) of the column within the relation. |
| `column_default` | `string` | ✅ | The default value used when the column is not specified in an INSERT, NULL if undefined. |
| `is_nullable` | `string` | ✅ | YES if column is nullable, NO otherwise. |
| `full_data_type` | `string` | ✅ | The data type as specified in the column definition. |
| `data_type` | `string` | ✅ | The simple data type name of the column, or STRUCT, or ARRAY. |
| `character_maximum_length` | `bigint` | ✅ | Always NULL, reserved for future use. |
| `character_octet_length` | `bigint` | ✅ | Always NULL, reserved for future use. |
| `numeric_precision` | `int` | ✅ | For base-2 integral numeric types, FLOAT, and DOUBLE, the number of supported bits. For DECIMAL the number of digits, NULL otherwise. |
| `numeric_precision_radix` | `int` | ✅ | For DECIMAL 10, for all other numeric types 2, NULL otherwise. |
| `numeric_scale` | `int` | ✅ | For integral numeric types 0, for DECIMAL the number of digits to the right of the decimal point, NULL otherwise. |
| `datetime_precision` | `int` | ✅ | For DATE 0, for TIMESTAMP, and INTERVAL … SECOND 6, any other INTERVAL 0, NULL otherwise. |
| `interval_type` | `string` | ✅ | For INTERVAL the unit portion of the interval, e.g. 'YEAR TO MONTH', NULL otherwise. |
| `interval_precision` | `int` | ✅ | Always NULL, reserved for future use. |
| `maximum_cardinality` | `bigint` | ✅ | Always NULL, reserved for future use. |
| `is_identity` | `string` | ✅ | Always ‘NO’, reserved for future use. |
| `identity_generation` | `string` | ✅ | Always NULL, reserved for future use. |
| `identity_start` | `string` | ✅ | Always NULL, reserved for future use. |
| `identity_increment` | `string` | ✅ | Always NULL, reserved for future use. |
| `identity_maximum` | `string` | ✅ | Always NULL, reserved for future use. |
| `identity_minimum` | `string` | ✅ | Always NULL, reserved for future use. |
| `identity_cycle` | `string` | ✅ | Always NULL, reserved for future use. |
| `is_generated` | `string` | ✅ | Always NULL, reserved for future use. |
| `generation_expression` | `string` | ✅ | Always NULL, reserved for future use. |
| `is_system_time_period_start` | `string` | ✅ | Always NO, reserved for future use. |
| `is_system_time_period_end` | `string` | ✅ | Always NO, reserved for future use. |
| `system_time_period_timestamp_generation` | `string` | ✅ | Always NULL, reserved for future use. |
| `is_updatable` | `string` | ✅ | YES if column is updatable, NO otherwise. |
| `partition_index` | `int` | ✅ | Position (numbered from 1) of the column in the partition, NULL if not a partitioning column. |
| `comment` | `string` | ✅ | Optional description of the column. |

### Table: `constraint_column_usage`

**Full Name:** `classwaves.information_schema.constraint_column_usage`
**Columns:** 7

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `table_catalog` | `string` | ✅ | Catalog containing the relation. |
| `table_schema` | `string` | ✅ | Schema containing the relation. |
| `table_name` | `string` | ✅ | Name of the relation. |
| `column_name` | `string` | ✅ | Name of the column. |
| `constraint_catalog` | `string` | ✅ | Catalog containing the constraint. |
| `constraint_schema` | `string` | ✅ | Schema containing the constraint. |
| `constraint_name` | `string` | ✅ | Name of the constraint. |

### Table: `constraint_table_usage`

**Full Name:** `classwaves.information_schema.constraint_table_usage`
**Columns:** 6

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `table_catalog` | `string` | ✅ | Catalog containing the relation. |
| `table_schema` | `string` | ✅ | Schema containing the relation. |
| `table_name` | `string` | ✅ | Name of the relation. |
| `constraint_catalog` | `string` | ✅ | Catalog containing the constraint. |
| `constraint_schema` | `string` | ✅ | Schema containing the constraint. |
| `constraint_name` | `string` | ✅ | Name of the constraint. |

### Table: `information_schema_catalog_name`

**Full Name:** `classwaves.information_schema.information_schema_catalog_name`
**Columns:** 1

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `catalog_name` | `string` | ✅ | The name of the catalog containing this information schema. |

### Table: `key_column_usage`

**Full Name:** `classwaves.information_schema.key_column_usage`
**Columns:** 9

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `constraint_catalog` | `string` | ✅ | Catalog containing the constraint. |
| `constraint_schema` | `string` | ✅ | Schema containing the constraint. |
| `constraint_name` | `string` | ✅ | Name of the constraint. |
| `table_catalog` | `string` | ✅ | Catalog containing the table. |
| `table_schema` | `string` | ✅ | Schema containing the table. |
| `table_name` | `string` | ✅ | Name of the table in which the constraint is defined. |
| `column_name` | `string` | ✅ | Name of the column. |
| `ordinal_position` | `int` | ✅ | Position (1-based) of the column in the key. |
| `position_in_unique_constraint` | `int` | ✅ | For foreign key, position (1-based) of the column in parent unique or primary key constraint, NULL otherwise. |

### Table: `parameters`

**Full Name:** `classwaves.information_schema.parameters`
**Columns:** 21

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `specific_catalog` | `string` | ✅ | Catalog containing the routine. |
| `specific_schema` | `string` | ✅ | Database (schema) containing the routine. |
| `specific_name` | `string` | ✅ | Schema unique (specific) name of the routine. |
| `ordinal_position` | `int` | ✅ | The position (1-based) of the parameter in the routine parameter list. |
| `parameter_mode` | `string` | ✅ | The parameter mode, 'IN' 'OUT' or 'INOUT. |
| `is_result` | `string` | ✅ | Always 'NO'. Reserved for future use. |
| `as_locator` | `string` | ✅ | Always 'NO'. Reserved for future use. |
| `parameter_name` | `string` | ✅ | Name of the parameters, NULL if unnamed. |
| `data_type` | `string` | ✅ | The parameter data type name. |
| `full_data_type` | `string` | ✅ | The parameter data type definition, for example 'DECIMAL(10, 4)'. |
| `character_maximum_length` | `bigint` | ✅ | Always NULL, reserved for future use. |
| `character_octet_length` | `bigint` | ✅ | Always NULL, reserved for future use. |
| `numeric_precision` | `int` | ✅ | For base-2 integral numeric types, FLOAT, and DOUBLE, the number of supported bits. For DECIMAL the number of digits, NULL otherwise. |
| `numeric_precision_radix` | `int` | ✅ | For DECIMAL 10, for all other numeric types 2, NULL otherwise. |
| `numeric_scale` | `int` | ✅ | For integral numeric types 0, for DECIMAL the number of digits to the right of the decimal point, NULL otherwise. |
| `datetime_precision` | `int` | ✅ | For DATE 0, for TIMESTAMP, and INTERVAL … SECOND 6, any other INTERVAL 0, NULL otherwise. |
| `interval_type` | `string` | ✅ | For INTERVAL the unit portion of the interval, e.g. 'YEAR TO MONTH', NULL otherwise. |
| `interval_precision` | `int` | ✅ | Always NULL, reserved for future use. |
| `maximum_cardinality` | `bigint` | ✅ | Always NULL, reserved for future use. |
| `parameter_default` | `string` | ✅ | Always NULL, reserved for future use. |
| `comment` | `string` | ✅ | An optional comment describing the parameter. |

### Table: `referential_constraints`

**Full Name:** `classwaves.information_schema.referential_constraints`
**Columns:** 9

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `constraint_catalog` | `string` | ✅ | Catalog containing the foreign key constraint. |
| `constraint_schema` | `string` | ✅ | Schema containing the foreign key constraints. |
| `constraint_name` | `string` | ✅ | Name of the check constraint. |
| `unique_constraint_catalog` | `string` | ✅ | Catalog containing the referenced constraint. |
| `unique_constraint_schema` | `string` | ✅ | Schema containing the referenced constraint. |
| `unique_constraint_name` | `string` | ✅ | Name of the referenced constraint. |
| `match_option` | `string` | ✅ | Always FULL, reserved for future use.. |
| `update_rule` | `string` | ✅ | Always NO ACTION, reserved for future use. |
| `delete_rule` | `string` | ✅ | Always NO ACTION, reserved for future use. |

### Table: `routine_columns`

**Full Name:** `classwaves.information_schema.routine_columns`
**Columns:** 17

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `specific_catalog` | `string` | ✅ | Catalog containing the routine. |
| `specific_schema` | `string` | ✅ | Database (schema) containing the routine. |
| `specific_name` | `string` | ✅ | Schema unique (specific) name of the routine. |
| `ordinal_position` | `int` | ✅ | The position (1-based) of the column in the result column list. |
| `column_name` | `string` | ✅ | Name of the column, NULL if unnamed. |
| `data_type` | `string` | ✅ | The parameter data type name. |
| `full_data_type` | `string` | ✅ | The parameter data type definition, for example 'DECIMAL(10, 4)'. |
| `character_maximum_length` | `bigint` | ✅ | Always NULL, reserved for future use. |
| `character_octet_length` | `bigint` | ✅ | Always NULL, reserved for future use. |
| `numeric_precision` | `int` | ✅ | For base-2 integral numeric types, FLOAT, and DOUBLE, the number of supported bits. For DECIMAL the number of digits, NULL otherwise. |
| `numeric_precision_radix` | `int` | ✅ | For DECIMAL 10, for all other numeric types 2, NULL otherwise. |
| `numeric_scale` | `int` | ✅ | For integral numeric types 0, for DECIMAL the number of digits to the right of the decimal point, NULL otherwise. |
| `datetime_precision` | `int` | ✅ | For DATE 0, for TIMESTAMP, and INTERVAL … SECOND 6, any other INTERVAL 0, NULL otherwise. |
| `interval_type` | `string` | ✅ | For INTERVAL the unit portion of the interval, e.g. 'YEAR TO MONTH', NULL otherwise. |
| `interval_precision` | `int` | ✅ | Always NULL, reserved for future use. |
| `maximum_cardinality` | `bigint` | ✅ | Always NULL, reserved for future use. |
| `comment` | `string` | ✅ | An optional comment describing the result column. |

### Table: `routine_privileges`

**Full Name:** `classwaves.information_schema.routine_privileges`
**Columns:** 11

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `grantor` | `string` | ✅ | Principal who granted the privilege. |
| `grantee` | `string` | ✅ | Principal to which the privilege is granted. |
| `specific_catalog` | `string` | ✅ | Catalog of routine on which the privilege is granted. |
| `specific_schema` | `string` | ✅ | Database of routine on which the privilege is granted. |
| `specific_name` | `string` | ✅ | Schema unique (specific) name of routine on which the privilege is granted. |
| `routine_catalog` | `string` | ✅ | Matches SPECIFIC_CATALOG. |
| `routine_schema` | `string` | ✅ | Matches SPECIFIC_SCHEMA. |
| `routine_name` | `string` | ✅ | Name of routine on which the privilege is granted. |
| `privilege_type` | `string` | ✅ | Privilege being granted. |
| `is_grantable` | `string` | ✅ | Always NO. Reserved for future use. |
| `inherited_from` | `string` | ✅ | The ancestor relation that the privilege is inherited from. |

### Table: `routines`

**Full Name:** `classwaves.information_schema.routines`
**Columns:** 34

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `specific_catalog` | `string` | ✅ | Catalog containing the routine. |
| `specific_schema` | `string` | ✅ | Database (schema) containing the routine. |
| `specific_name` | `string` | ✅ | Schema unique (specific) name of the routine. |
| `routine_catalog` | `string` | ✅ | Matches SPECIFIC_CATALOG. |
| `routine_schema` | `string` | ✅ | Matches SPECIFIC_SCHEMA. |
| `routine_name` | `string` | ✅ | Name of the routine. |
| `routine_owner` | `string` | ✅ |  |
| `routine_type` | `string` | ✅ | The routine type, 'FUNCTION' or 'PROCEDURE'. |
| `data_type` | `string` | ✅ | The result data type name, or 'TABLE' for a table valued function, 'NULL' for procedures. |
| `full_data_type` | `string` | ✅ | The result data type definition, for example 'DECIMAL(10, 4)', 'NULL' for procedures. |
| `character_maximum_length` | `bigint` | ✅ | Always NULL, reserved for future use. |
| `character_octet_length` | `bigint` | ✅ | Always NULL, reserved for future use. |
| `numeric_precision` | `int` | ✅ | For base-2 integral numeric types, FLOAT, and DOUBLE, the number of supported bits. For DECIMAL the number of digits, NULL otherwise. |
| `numeric_precision_radix` | `int` | ✅ | For DECIMAL 10, for all other numeric types 2, NULL otherwise. |
| `numeric_scale` | `int` | ✅ | For integral numeric types 0, for DECIMAL the number of digits to the right of the decimal point, NULL otherwise. |
| `datetime_precision` | `int` | ✅ | For DATE 0, for TIMESTAMP, and INTERVAL … SECOND 6, any other INTERVAL 0, NULL otherwise. |
| `interval_type` | `string` | ✅ | For INTERVAL the unit portion of the interval, e.g. 'YEAR TO MONTH', NULL otherwise. |
| `interval_precision` | `int` | ✅ | Always NULL, reserved for future use. |
| `maximum_cardinality` | `bigint` | ✅ | Always NULL, reserved for future use. |
| `routine_body` | `string` | ✅ | The routine body, 'SQL' or 'EXTERNAL'. |
| `routine_definition` | `string` | ✅ | The full definition of the routine. NULL if the user is not the owner. |
| `external_name` | `string` | ✅ | Always NULL, reserved for future use. |
| `external_language` | `string` | ✅ | The routine language, 'SQL' or 'Python' or 'FeatureSpec' or NULL. |
| `parameter_style` | `string` | ✅ | Always 'SQL', reserved for future use. |
| `is_deterministic` | `string` | ✅ | 'YES' if routine defined as deterministic, 'NO' otherwise. |
| `sql_data_access` | `string` | ✅ | 'MODIFIES SQL DATA' for procedures, 'READS SQL DATA' if routine reads from a relation, 'CONTAINS SQL' otherwise. |
| `is_null_call` | `string` | ✅ | Always 'YES', reserved for future use. |
| `security_type` | `string` | ✅ | The security type, 'DEFINER' or 'INVOKER'. |
| `sql_path` | `string` | ✅ | Always NULL, reserved for future use. |
| `comment` | `string` | ✅ | An optional comment describing the routine. |
| `created` | `timestamp` | ✅ | Timestamp when the routine was created. |
| `created_by` | `string` | ✅ | Principal which created the routine. |
| `last_altered` | `timestamp` | ✅ | Timestamp when the routine definition was last altered in any way. |
| `last_altered_by` | `string` | ✅ | Principal which last altered the routine. |

### Table: `row_filters`

**Full Name:** `classwaves.information_schema.row_filters`
**Columns:** 5

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `table_catalog` | `string` | ✅ |  |
| `table_schema` | `string` | ✅ |  |
| `table_name` | `string` | ✅ |  |
| `filter_name` | `string` | ✅ |  |
| `target_columns` | `string` | ✅ |  |

### Table: `schema_privileges`

**Full Name:** `classwaves.information_schema.schema_privileges`
**Columns:** 7

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `grantor` | `string` | ✅ | Principal that granted the privilege. |
| `grantee` | `string` | ✅ | Principal to which the privilege is granted. |
| `catalog_name` | `string` | ✅ | Catalog of schema on which the privilege is granted. |
| `schema_name` | `string` | ✅ | Schema on which the privilege is granted. |
| `privilege_type` | `string` | ✅ | Privilege being granted. |
| `is_grantable` | `string` | ✅ | Always NO. Reserved for future use. |
| `inherited_from` | `string` | ✅ | The ancestor relation that the privilege is inherited from. |

### Table: `schema_tags`

**Full Name:** `classwaves.information_schema.schema_tags`
**Columns:** 4

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `catalog_name` | `string` | ✅ |  |
| `schema_name` | `string` | ✅ |  |
| `tag_name` | `string` | ✅ |  |
| `tag_value` | `string` | ✅ |  |

### Table: `schemata`

**Full Name:** `classwaves.information_schema.schemata`
**Columns:** 8

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `catalog_name` | `string` | ✅ | Catalog containing the schema. |
| `schema_name` | `string` | ✅ | Name of the schema. |
| `schema_owner` | `string` | ✅ | User or group (principal) that currently owns the schema. |
| `comment` | `string` | ✅ | An optional comment that describes the relation. |
| `created` | `timestamp` | ✅ | Timestamp when the relation was created. |
| `created_by` | `string` | ✅ | Principal which created the relation. |
| `last_altered` | `timestamp` | ✅ | Timestamp when the relation definition was last altered in any way. |
| `last_altered_by` | `string` | ✅ | Principal which last altered the relation. |

### Table: `table_constraints`

**Full Name:** `classwaves.information_schema.table_constraints`
**Columns:** 10

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `constraint_catalog` | `string` | ✅ | Catalog containing the constraint. |
| `constraint_schema` | `string` | ✅ | Schema containing the constraint. |
| `constraint_name` | `string` | ✅ | Name of the constraint. |
| `table_catalog` | `string` | ✅ | Catalog containing the table. |
| `table_schema` | `string` | ✅ | Schema containing the table. |
| `table_name` | `string` | ✅ | Name of the table in which the constraint is defined. |
| `constraint_type` | `string` | ✅ | One of 'CHECK', 'PRIMARY KEY', 'FOREIGN KEY' |
| `is_deferrable` | `string` | ✅ | Always`’YES’`. Reserved for future use. |
| `initially_deferred` | `string` | ✅ | Always 'YES'. Reserved for future use. |
| `enforced` | `string` | ✅ | 'YES' if constraint is enforced, 'NO' otherwise. |

### Table: `table_privileges`

**Full Name:** `classwaves.information_schema.table_privileges`
**Columns:** 8

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `grantor` | `string` | ✅ | Principal that granted the privilege. |
| `grantee` | `string` | ✅ | Principal to which the privilege is granted. |
| `table_catalog` | `string` | ✅ | Catalog of relation on which the privilege is granted. |
| `table_schema` | `string` | ✅ | Schema of relation on which the privilege is granted. |
| `table_name` | `string` | ✅ | Relation on which the privilege is granted. |
| `privilege_type` | `string` | ✅ | Privilege being granted. |
| `is_grantable` | `string` | ✅ | Always NO. Reserved for future use. |
| `inherited_from` | `string` | ✅ | The ancestor relation that the privilege is inherited from. |

### Table: `table_tags`

**Full Name:** `classwaves.information_schema.table_tags`
**Columns:** 5

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `catalog_name` | `string` | ✅ |  |
| `schema_name` | `string` | ✅ |  |
| `table_name` | `string` | ✅ |  |
| `tag_name` | `string` | ✅ |  |
| `tag_value` | `string` | ✅ |  |

### Table: `tables`

**Full Name:** `classwaves.information_schema.tables`
**Columns:** 15

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `table_catalog` | `string` | ✅ | Catalog that contains the relation. |
| `table_schema` | `string` | ✅ | Schema that contains the relation. |
| `table_name` | `string` | ✅ | Name of the relation. |
| `table_type` | `string` | ✅ | Type of the table such as 'MANAGED', 'FOREIGN', 'VIEW', etc. |
| `is_insertable_into` | `string` | ✅ | 'YES' if the relation can be inserted into, 'NO' otherwise. |
| `commit_action` | `string` | ✅ | Always 'PRESERVE'. Reserved for future use. |
| `table_owner` | `string` | ✅ | User or group (principal) currently owning the relation. |
| `comment` | `string` | ✅ | An optional comment that describes the relation. |
| `created` | `timestamp` | ✅ | Timestamp when the relation was created. |
| `created_by` | `string` | ✅ | Principal which created the relation. |
| `last_altered` | `timestamp` | ✅ | Timestamp when the relation definition was last altered in any way. |
| `last_altered_by` | `string` | ✅ | Principal which last altered the relation. |
| `data_source_format` | `string` | ✅ | Format of the data source such as PARQUET, or CSV. |
| `storage_sub_directory` | `string` | ✅ | Path to the storage of an external table, NULL otherwise. |
| `storage_path` | `string` | ✅ |  |

### Table: `views`

**Full Name:** `classwaves.information_schema.views`
**Columns:** 9

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `table_catalog` | `string` | ✅ | Catalog containing the view. |
| `table_schema` | `string` | ✅ | Schema containing the view. |
| `table_name` | `string` | ✅ | Name of the relation. |
| `view_definition` | `string` | ✅ | The view text if the user owns the view, NULL otherwise. |
| `check_option` | `string` | ✅ | Always 'NONE'. Reserved for future use. |
| `is_updatable` | `string` | ✅ | Always NO. Reserved for future use |
| `is_insertable_into` | `string` | ✅ | Always NO. Reserved for future use. |
| `sql_path` | `string` | ✅ | Always NULL. Reserved for future use. |
| `is_materialized` | `string` | ✅ |  |

### Table: `volume_privileges`

**Full Name:** `classwaves.information_schema.volume_privileges`
**Columns:** 8

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `grantor` | `string` | ✅ |  |
| `grantee` | `string` | ✅ |  |
| `volume_catalog` | `string` | ✅ |  |
| `volume_schema` | `string` | ✅ |  |
| `volume_name` | `string` | ✅ |  |
| `privilege_type` | `string` | ✅ |  |
| `is_grantable` | `string` | ✅ |  |
| `inherited_from` | `string` | ✅ |  |

### Table: `volume_tags`

**Full Name:** `classwaves.information_schema.volume_tags`
**Columns:** 5

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `catalog_name` | `string` | ✅ |  |
| `schema_name` | `string` | ✅ |  |
| `volume_name` | `string` | ✅ |  |
| `tag_name` | `string` | ✅ |  |
| `tag_value` | `string` | ✅ |  |

### Table: `volumes`

**Full Name:** `classwaves.information_schema.volumes`
**Columns:** 11

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `volume_catalog` | `string` | ✅ |  |
| `volume_schema` | `string` | ✅ |  |
| `volume_name` | `string` | ✅ |  |
| `volume_type` | `string` | ✅ |  |
| `volume_owner` | `string` | ✅ |  |
| `comment` | `string` | ✅ |  |
| `storage_location` | `string` | ✅ |  |
| `created` | `timestamp` | ✅ |  |
| `created_by` | `string` | ✅ |  |
| `last_altered` | `timestamp` | ✅ |  |
| `last_altered_by` | `string` | ✅ |  |

---

## Schema: `notifications`

**Tables:** 2

### Table: `notification_queue`

**Full Name:** `classwaves.notifications.notification_queue`
**Columns:** 19
**Row Count:** 15
**Last Updated:** 2025-09-14

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `user_id` | `string` | ✅ |  |
| `notification_type` | `string` | ✅ |  |
| `priority` | `string` | ✅ |  |
| `channel` | `string` | ✅ |  |
| `recipient_address` | `string` | ✅ |  |
| `subject` | `string` | ✅ |  |
| `content` | `string` | ✅ |  |
| `template_id` | `string` | ✅ |  |
| `template_data` | `map<string,string>` | ✅ |  |
| `scheduled_for` | `timestamp` | ✅ |  |
| `expires_at` | `timestamp` | ✅ |  |
| `retry_count` | `int` | ✅ |  |
| `max_retries` | `int` | ✅ |  |
| `status` | `string` | ✅ |  |
| `sent_at` | `timestamp` | ✅ |  |
| `failed_at` | `timestamp` | ✅ |  |
| `failure_reason` | `string` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |

### Table: `templates`

**Full Name:** `classwaves.notifications.templates`
**Columns:** 13
**Row Count:** 0

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `name` | `string` | ✅ |  |
| `description` | `string` | ✅ |  |
| `channel` | `string` | ✅ |  |
| `category` | `string` | ✅ |  |
| `subject_template` | `string` | ✅ |  |
| `body_template` | `string` | ✅ |  |
| `variables` | `array<string>` | ✅ |  |
| `is_active` | `boolean` | ✅ |  |
| `version` | `int` | ✅ |  |
| `created_by` | `string` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |
| `updated_at` | `timestamp` | ✅ |  |

---

## Schema: `operational`

**Tables:** 3

### Table: `api_metrics`

**Full Name:** `classwaves.operational.api_metrics`
**Columns:** 10
**Row Count:** 0

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `endpoint` | `string` | ✅ |  |
| `method` | `string` | ✅ |  |
| `response_time_ms` | `int` | ✅ |  |
| `status_code` | `int` | ✅ |  |
| `user_id` | `string` | ✅ |  |
| `school_id` | `string` | ✅ |  |
| `ip_address` | `string` | ✅ |  |
| `user_agent` | `string` | ✅ |  |
| `timestamp` | `timestamp` | ✅ |  |

### Table: `background_jobs`

**Full Name:** `classwaves.operational.background_jobs`
**Columns:** 12
**Row Count:** 0

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `job_type` | `string` | ✅ |  |
| `status` | `string` | ✅ |  |
| `scheduled_at` | `timestamp` | ✅ |  |
| `started_at` | `timestamp` | ✅ |  |
| `completed_at` | `timestamp` | ✅ |  |
| `parameters` | `string` | ✅ |  |
| `result` | `string` | ✅ |  |
| `error_message` | `string` | ✅ |  |
| `retry_count` | `int` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |
| `updated_at` | `timestamp` | ✅ |  |

### Table: `system_events`

**Full Name:** `classwaves.operational.system_events`
**Columns:** 10
**Row Count:** 907
**Last Updated:** 2025-09-10

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `event_type` | `string` | ✅ |  |
| `severity` | `string` | ✅ |  |
| `component` | `string` | ✅ |  |
| `message` | `string` | ✅ |  |
| `error_details` | `string` | ✅ |  |
| `school_id` | `string` | ✅ |  |
| `session_id` | `string` | ✅ |  |
| `user_id` | `string` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |

---

## Schema: `sessions`

**Tables:** 5

### Table: `classroom_sessions`

**Full Name:** `classwaves.sessions.classroom_sessions`
**Columns:** 32
**Row Count:** 425
**Last Updated:** 2025-09-14

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `title` | `string` | ✅ |  |
| `description` | `string` | ✅ |  |
| `status` | `string` | ✅ |  |
| `scheduled_start` | `timestamp` | ✅ |  |
| `actual_start` | `timestamp` | ✅ |  |
| `actual_end` | `timestamp` | ✅ |  |
| `planned_duration_minutes` | `int` | ✅ |  |
| `actual_duration_minutes` | `int` | ✅ |  |
| `max_students` | `int` | ✅ |  |
| `target_group_size` | `int` | ✅ |  |
| `auto_group_enabled` | `boolean` | ✅ |  |
| `teacher_id` | `string` | ✅ |  |
| `school_id` | `string` | ✅ |  |
| `recording_enabled` | `boolean` | ✅ |  |
| `transcription_enabled` | `boolean` | ✅ |  |
| `ai_analysis_enabled` | `boolean` | ✅ |  |
| `ferpa_compliant` | `boolean` | ✅ |  |
| `coppa_compliant` | `boolean` | ✅ |  |
| `recording_consent_obtained` | `boolean` | ✅ |  |
| `data_retention_date` | `timestamp` | ✅ |  |
| `total_groups` | `int` | ✅ |  |
| `total_students` | `int` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |
| `updated_at` | `timestamp` | ✅ |  |
| `access_code` | `string` | ✅ |  |
| `end_reason` | `string` | ✅ |  |
| `teacher_notes` | `string` | ✅ |  |
| `engagement_score` | `decimal(5,2)` | ✅ |  |
| `participation_rate` | `decimal(5,2)` | ✅ |  |
| `goal` | `string` | ✅ | Learning goal/objectives for the session |
| `subject` | `string` | ✅ | Subject area for the session |

### Table: `participants`

**Full Name:** `classwaves.sessions.participants`
**Columns:** 20
**Row Count:** 149
**Last Updated:** 2025-09-14

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `session_id` | `string` | ✅ |  |
| `group_id` | `string` | ✅ |  |
| `student_id` | `string` | ✅ |  |
| `anonymous_id` | `string` | ✅ |  |
| `display_name` | `string` | ✅ |  |
| `join_time` | `timestamp` | ✅ |  |
| `leave_time` | `timestamp` | ✅ |  |
| `is_active` | `boolean` | ✅ |  |
| `device_type` | `string` | ✅ |  |
| `browser_info` | `string` | ✅ |  |
| `connection_quality` | `string` | ✅ |  |
| `can_speak` | `boolean` | ✅ |  |
| `can_hear` | `boolean` | ✅ |  |
| `is_muted` | `boolean` | ✅ |  |
| `total_speaking_time_seconds` | `int` | ✅ |  |
| `message_count` | `int` | ✅ |  |
| `interaction_count` | `int` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |
| `updated_at` | `timestamp` | ✅ |  |

### Table: `student_group_members`

**Full Name:** `classwaves.sessions.student_group_members`
**Columns:** 5
**Row Count:** 1,079
**Last Updated:** 2025-09-14

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `session_id` | `string` | ✅ |  |
| `group_id` | `string` | ✅ |  |
| `student_id` | `string` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |

### Table: `student_groups`

**Full Name:** `classwaves.sessions.student_groups`
**Columns:** 21
**Row Count:** 725
**Last Updated:** 2025-09-14

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `session_id` | `string` | ✅ |  |
| `name` | `string` | ✅ |  |
| `group_number` | `int` | ✅ |  |
| `status` | `string` | ✅ |  |
| `max_size` | `int` | ✅ |  |
| `current_size` | `int` | ✅ |  |
| `auto_managed` | `boolean` | ✅ |  |
| `start_time` | `timestamp` | ✅ |  |
| `end_time` | `timestamp` | ✅ |  |
| `total_speaking_time_seconds` | `int` | ✅ |  |
| `collaboration_score` | `decimal(5,2)` | ✅ |  |
| `topic_focus_score` | `decimal(5,2)` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |
| `updated_at` | `timestamp` | ✅ |  |
| `leader_id` | `string` | ✅ |  |
| `is_ready` | `boolean` | ✅ |  |
| `topical_cohesion` | `decimal(5,2)` | ✅ | Metric indicating how focused the group discussion is. |
| `argumentation_quality` | `decimal(5,2)` | ✅ | Score representing the quality of arguments, evidence, and reasoning. |
| `sentiment_arc` | `string` | ✅ | JSON string representing the trend of the group sentiment over time. |
| `conceptual_density` | `decimal(5,2)` | ✅ | Lexical richness of group discussion. |

### Table: `transcriptions`

**Full Name:** `classwaves.sessions.transcriptions`
**Columns:** 17
**Row Count:** 325
**Last Updated:** 2025-09-14

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `session_id` | `string` | ✅ |  |
| `group_id` | `string` | ✅ |  |
| `speaker_id` | `string` | ✅ |  |
| `speaker_type` | `string` | ✅ |  |
| `speaker_name` | `string` | ✅ |  |
| `content` | `string` | ✅ |  |
| `language_code` | `string` | ✅ |  |
| `start_time` | `timestamp` | ✅ |  |
| `end_time` | `timestamp` | ✅ |  |
| `duration_seconds` | `decimal(10,3)` | ✅ |  |
| `confidence_score` | `decimal(5,4)` | ✅ |  |
| `is_final` | `boolean` | ✅ |  |
| `sentiment` | `string` | ✅ |  |
| `key_phrases` | `string` | ✅ |  |
| `academic_vocabulary_detected` | `boolean` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |

---

## Schema: `users`

**Tables:** 7

### Table: `analytics_job_metadata`

**Full Name:** `classwaves.users.analytics_job_metadata`
**Columns:** 9
**Row Count:** 0

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `job_name` | `string` | ✅ |  |
| `processing_period` | `timestamp` | ✅ |  |
| `last_run` | `timestamp` | ✅ |  |
| `records_processed` | `int` | ✅ |  |
| `status` | `string` | ✅ |  |
| `error_message` | `string` | ✅ |  |
| `execution_duration_seconds` | `int` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |
| `updated_at` | `timestamp` | ✅ |  |

### Table: `dashboard_metrics_hourly`

**Full Name:** `classwaves.users.dashboard_metrics_hourly`
**Columns:** 28
**Row Count:** 0

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `school_id` | `string` | ✅ |  |
| `metric_hour` | `timestamp` | ✅ |  |
| `sessions_active` | `int` | ✅ |  |
| `sessions_completed` | `int` | ✅ |  |
| `teachers_active` | `int` | ✅ |  |
| `students_active` | `int` | ✅ |  |
| `avg_session_quality` | `double` | ✅ |  |
| `avg_engagement_score` | `double` | ✅ |  |
| `avg_participation_rate` | `double` | ✅ |  |
| `avg_collaboration_score` | `double` | ✅ |  |
| `avg_audio_quality` | `double` | ✅ |  |
| `avg_connection_stability` | `double` | ✅ |  |
| `total_errors` | `int` | ✅ |  |
| `avg_response_time` | `double` | ✅ |  |
| `total_prompts_generated` | `int` | ✅ |  |
| `total_prompts_used` | `int` | ✅ |  |
| `total_interventions` | `int` | ✅ |  |
| `total_alerts` | `int` | ✅ |  |
| `ai_analyses_completed` | `int` | ✅ |  |
| `avg_ai_processing_time` | `double` | ✅ |  |
| `ai_analysis_success_rate` | `double` | ✅ |  |
| `total_transcription_minutes` | `double` | ✅ |  |
| `total_storage_gb` | `double` | ✅ |  |
| `estimated_compute_cost` | `double` | ✅ |  |
| `data_sources_count` | `int` | ✅ |  |
| `calculation_method` | `string` | ✅ |  |
| `calculated_at` | `timestamp` | ✅ |  |

### Table: `schools`

**Full Name:** `classwaves.users.schools`
**Columns:** 19
**Row Count:** 203
**Last Updated:** 2025-09-04

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `name` | `string` | ✅ |  |
| `domain` | `string` | ✅ |  |
| `google_workspace_id` | `string` | ✅ |  |
| `admin_email` | `string` | ✅ |  |
| `subscription_tier` | `string` | ✅ |  |
| `subscription_status` | `string` | ✅ |  |
| `max_teachers` | `int` | ✅ |  |
| `current_teachers` | `int` | ✅ |  |
| `stripe_customer_id` | `string` | ✅ |  |
| `subscription_start_date` | `timestamp` | ✅ |  |
| `subscription_end_date` | `timestamp` | ✅ |  |
| `trial_ends_at` | `timestamp` | ✅ |  |
| `ferpa_agreement` | `boolean` | ✅ |  |
| `coppa_compliant` | `boolean` | ✅ |  |
| `data_retention_days` | `int` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |
| `updated_at` | `timestamp` | ✅ |  |
| `domain` | `string` | ✅ |  |

### Table: `session_analytics_cache`

**Full Name:** `classwaves.users.session_analytics_cache`
**Columns:** 39
**Row Count:** 4

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `session_id` | `string` | ✅ |  |
| `teacher_id` | `string` | ✅ |  |
| `school_id` | `string` | ✅ |  |
| `session_date` | `date` | ✅ |  |
| `session_status` | `string` | ✅ |  |
| `session_overall_score` | `double` | ✅ |  |
| `session_effectiveness_score` | `double` | ✅ |  |
| `session_duration_minutes` | `int` | ✅ |  |
| `total_participants` | `int` | ✅ |  |
| `planned_groups` | `int` | ✅ |  |
| `actual_groups` | `int` | ✅ |  |
| `group_completion_rate` | `double` | ✅ |  |
| `participation_rate` | `double` | ✅ |  |
| `avg_engagement_score` | `double` | ✅ |  |
| `leader_readiness_rate` | `double` | ✅ |  |
| `avg_readiness_time_minutes` | `double` | ✅ |  |
| `groups_ready_at_start` | `int` | ✅ |  |
| `groups_ready_at_5min` | `int` | ✅ |  |
| `groups_ready_at_10min` | `int` | ✅ |  |
| `avg_group_score` | `double` | ✅ |  |
| `avg_critical_thinking_score` | `double` | ✅ |  |
| `avg_participation_balance` | `double` | ✅ |  |
| `total_ai_analyses` | `int` | ✅ |  |
| `avg_ai_confidence` | `double` | ✅ |  |
| `key_insights` | `string` | ✅ |  |
| `intervention_recommendations` | `string` | ✅ |  |
| `leader_ready_events` | `string` | ✅ |  |
| `intervention_events` | `string` | ✅ |  |
| `avg_audio_quality` | `double` | ✅ |  |
| `avg_connection_stability` | `double` | ✅ |  |
| `error_count` | `int` | ✅ |  |
| `total_transcription_time` | `double` | ✅ |  |
| `cache_freshness` | `string` | ✅ |  |
| `last_real_time_update` | `timestamp` | ✅ |  |
| `last_full_calculation` | `timestamp` | ✅ |  |
| `cache_hit_count` | `int` | ✅ |  |
| `fallback_count` | `int` | ✅ |  |
| `cached_at` | `timestamp` | ✅ |  |

### Table: `students`

**Full Name:** `classwaves.users.students`
**Columns:** 20
**Row Count:** 36
**Last Updated:** 2025-09-14

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `display_name` | `string` | ✅ |  |
| `school_id` | `string` | ✅ |  |
| `email` | `string` | ✅ |  |
| `google_id` | `string` | ✅ |  |
| `status` | `string` | ✅ |  |
| `grade_level` | `string` | ✅ |  |
| `has_parental_consent` | `boolean` | ✅ |  |
| `consent_date` | `timestamp` | ✅ |  |
| `parent_email` | `string` | ✅ |  |
| `data_sharing_consent` | `boolean` | ✅ |  |
| `audio_recording_consent` | `boolean` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |
| `updated_at` | `timestamp` | ✅ |  |
| `given_name` | `string` | ✅ | Student given/first name |
| `family_name` | `string` | ✅ | Student family/last name |
| `preferred_name` | `string` | ✅ | Student preferred name |
| `email_consent` | `boolean` | ✅ |  |
| `coppa_compliant` | `boolean` | ✅ |  |
| `teacher_verified_age` | `boolean` | ✅ |  |

### Table: `teacher_analytics_summary`

**Full Name:** `classwaves.users.teacher_analytics_summary`
**Columns:** 32
**Row Count:** 0

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `teacher_id` | `string` | ✅ |  |
| `school_id` | `string` | ✅ |  |
| `summary_date` | `date` | ✅ |  |
| `total_sessions` | `int` | ✅ |  |
| `avg_session_score` | `double` | ✅ |  |
| `avg_effectiveness_score` | `double` | ✅ |  |
| `avg_participation_rate` | `double` | ✅ |  |
| `total_session_duration_minutes` | `int` | ✅ |  |
| `total_prompts_shown` | `int` | ✅ |  |
| `total_prompts_used` | `int` | ✅ |  |
| `total_prompts_dismissed` | `int` | ✅ |  |
| `prompt_usage_rate` | `double` | ✅ |  |
| `avg_prompt_response_time` | `double` | ✅ |  |
| `avg_engagement_score` | `double` | ✅ |  |
| `avg_collaboration_score` | `double` | ✅ |  |
| `avg_critical_thinking_score` | `double` | ✅ |  |
| `avg_discussion_quality_score` | `double` | ✅ |  |
| `total_interventions` | `int` | ✅ |  |
| `avg_intervention_rate` | `double` | ✅ |  |
| `total_alerts_generated` | `int` | ✅ |  |
| `avg_alert_response_time` | `double` | ✅ |  |
| `vs_peer_average` | `double` | ✅ |  |
| `vs_school_average` | `double` | ✅ |  |
| `improvement_trend` | `string` | ✅ |  |
| `avg_group_completion_rate` | `double` | ✅ |  |
| `total_leader_ready_events` | `int` | ✅ |  |
| `avg_group_readiness_time` | `double` | ✅ |  |
| `data_points_included` | `int` | ✅ |  |
| `confidence_score` | `double` | ✅ |  |
| `calculated_at` | `timestamp` | ✅ |  |
| `last_updated` | `timestamp` | ✅ |  |

### Table: `teachers`

**Full Name:** `classwaves.users.teachers`
**Columns:** 21
**Row Count:** 222
**Last Updated:** 2025-09-04

| Column | Type | Nullable | Comment |
|--------|------|----------|----------|
| `id` | `string` | ✅ |  |
| `google_id` | `string` | ✅ |  |
| `email` | `string` | ✅ |  |
| `name` | `string` | ✅ |  |
| `picture` | `string` | ✅ |  |
| `school_id` | `string` | ✅ |  |
| `role` | `string` | ✅ |  |
| `status` | `string` | ✅ |  |
| `access_level` | `string` | ✅ |  |
| `max_concurrent_sessions` | `int` | ✅ |  |
| `current_sessions` | `int` | ✅ |  |
| `grade` | `string` | ✅ |  |
| `subject` | `string` | ✅ |  |
| `timezone` | `string` | ✅ |  |
| `features_enabled` | `string` | ✅ |  |
| `last_login` | `timestamp` | ✅ |  |
| `login_count` | `int` | ✅ |  |
| `total_sessions_created` | `int` | ✅ |  |
| `created_at` | `timestamp` | ✅ |  |
| `updated_at` | `timestamp` | ✅ |  |
| `google_id` | `string` | ✅ |  |

---


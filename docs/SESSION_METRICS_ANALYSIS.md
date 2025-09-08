# Session Metrics Data Flow Analysis

**Generated:** 2025-09-07T14:20:23.406Z
**Purpose:** Analyze how session metrics should flow across different tables

## Key Tables for Session Data

**Session-Related Tables Found:** 19

### `ai_insights.session_guidance_analytics`

**Group/Student Related Columns:**
- `total_groups` (int) - No comment
- `total_students` (int) - No comment
- `student_engagement_improvement` (double) - No comment

**Metrics Columns:**
- `total_groups` (int) - No comment
- `total_students` (int) - No comment
- `total_prompts_generated` (int) - No comment
- `total_prompts_acknowledged` (int) - No comment
- `total_prompts_used` (int) - No comment
- `total_prompts_dismissed` (int) - No comment
- `total_prompts_expired` (int) - No comment
- `acknowledgment_rate` (double) - No comment
- `usage_rate` (double) - No comment
- `effectiveness_rate` (double) - No comment
- `avg_feedback_rating` (double) - No comment
- `avg_effectiveness_score` (double) - No comment
- `avg_response_time_seconds` (double) - No comment
- `session_improvement_score` (double) - No comment
- `learning_objective_completion_rate` (double) - No comment
- `error_count` (int) - No comment

**All Columns:**
- `id` (string)
- `session_id` (string)
- `teacher_id` (string)
- `school_id` (string)
- `session_date` (date)
- `subject_area` (string)
- `session_duration_minutes` (int)
- `total_groups` (int)
- `total_students` (int)
- `total_prompts_generated` (int)
- `total_prompts_acknowledged` (int)
- `total_prompts_used` (int)
- `total_prompts_dismissed` (int)
- `total_prompts_expired` (int)
- `acknowledgment_rate` (double)
- `usage_rate` (double)
- `effectiveness_rate` (double)
- `avg_feedback_rating` (double)
- `avg_effectiveness_score` (double)
- `avg_response_time_seconds` (double)
- `session_improvement_score` (double)
- `student_engagement_improvement` (double)
- `discussion_quality_improvement` (double)
- `learning_objective_completion_rate` (double)
- `category_breakdown` (map<string,struct<generated:int,used:int,effectiveness:double>>)
- `priority_breakdown` (map<string,struct<generated:int,used:int,effectiveness:double>>)
- `phase_breakdown` (map<string,struct<generated:int,used:int,effectiveness:double>>)
- `teacher_satisfaction_rating` (int)
- `teacher_feedback_text` (string)
- `would_recommend_system` (boolean)
- `ai_analysis_latency_ms` (double)
- `prompt_generation_latency_ms` (double)
- `system_uptime_percentage` (double)
- `error_count` (int)
- `compliance_violations` (int)
- `data_retention_compliance` (boolean)
- `privacy_safeguards_applied` (boolean)
- `created_at` (timestamp)
- `updated_at` (timestamp)
- `session_date` (date)

---

### `ai_insights.session_summaries`

**All Columns:**
- `id` (string)
- `session_id` (string)
- `summary_json` (string)
- `analysis_timestamp` (timestamp)
- `created_at` (timestamp)

---

### `ai_insights.teacher_guidance_metrics`

**Group/Student Related Columns:**
- `group_id` (string) - Target group for the prompt (if group-specific)

**Metrics Columns:**
- `generated_at` (timestamp) - When the prompt was generated
- `effectiveness_score` (double) - System-calculated effectiveness score

**All Columns:**
- `id` (string)
- `session_id` (string)
- `teacher_id` (string)
- `prompt_id` (string)
- `prompt_category` (string)
- `priority_level` (string)
- `prompt_message` (string)
- `prompt_context` (string)
- `suggested_timing` (string)
- `session_phase` (string)
- `subject_area` (string)
- `target_metric` (string)
- `learning_objectives` (string)
- `group_id` (string)
- `generated_at` (timestamp)
- `acknowledged_at` (timestamp)
- `used_at` (timestamp)
- `dismissed_at` (timestamp)
- `expires_at` (timestamp)
- `feedback_rating` (int)
- `feedback_text` (string)
- `effectiveness_score` (double)
- `learning_outcome_improvement` (double)
- `response_time_seconds` (int)
- `educational_purpose` (string)
- `compliance_basis` (string)
- `data_retention_date` (date)
- `created_at` (timestamp)
- `updated_at` (timestamp)

---

### `analytics.dashboard_metrics_hourly`

**Group/Student Related Columns:**
- `students_active` (int) - Number of unique students active during this hour
- `total_groups` (int) - Total number of groups active during this hour
- `ready_groups` (int) - Number of groups that were ready during this hour

**Metrics Columns:**
- `total_groups` (int) - Total number of groups active during this hour
- `avg_session_quality` (double) - Average session quality score for the hour
- `avg_engagement_score` (double) - Average student engagement score for the hour
- `avg_participation_rate` (double) - Average student participation rate for the hour
- `avg_collaboration_score` (double) - Average collaboration effectiveness for the hour
- `avg_audio_quality` (double) - Average audio quality score for the hour
- `avg_connection_stability` (double) - Average connection stability for the hour
- `total_errors` (int) - Total system errors during this hour
- `avg_response_time` (double) - Average system response time in milliseconds
- `avg_latency_ms` (double) - Average network latency in milliseconds
- `error_rate` (double) - Error rate as percentage (0.0-100.0)
- `total_prompts_generated` (int) - Total AI prompts generated during this hour
- `total_prompts_used` (int) - Total prompts acted upon by teachers
- `total_interventions` (int) - Total teacher interventions during this hour
- `total_alerts` (int) - Total system alerts generated during this hour
- `avg_ai_processing_time` (double) - Average AI processing time in milliseconds
- `ai_analysis_success_rate` (double) - AI analysis success rate as percentage
- `total_transcription_minutes` (double) - Total minutes of transcription processed
- `total_storage_gb` (double) - Total storage used in gigabytes
- `data_sources_count` (int) - Number of source records aggregated

**All Columns:**
- `id` (string)
- `school_id` (string)
- `metric_hour` (timestamp)
- `sessions_active` (int)
- `sessions_completed` (int)
- `teachers_active` (int)
- `students_active` (int)
- `total_groups` (int)
- `ready_groups` (int)
- `avg_session_quality` (double)
- `avg_engagement_score` (double)
- `avg_participation_rate` (double)
- `avg_collaboration_score` (double)
- `avg_audio_quality` (double)
- `avg_connection_stability` (double)
- `total_errors` (int)
- `avg_response_time` (double)
- `websocket_connections` (int)
- `avg_latency_ms` (double)
- `error_rate` (double)
- `total_prompts_generated` (int)
- `total_prompts_used` (int)
- `total_interventions` (int)
- `total_alerts` (int)
- `ai_analyses_completed` (int)
- `avg_ai_processing_time` (double)
- `ai_analysis_success_rate` (double)
- `total_transcription_minutes` (double)
- `total_storage_gb` (double)
- `estimated_compute_cost` (double)
- `data_sources_count` (int)
- `calculation_method` (string)
- `calculated_at` (timestamp)
- `created_at` (timestamp)

---

### `analytics.educational_metrics`

**All Columns:**
- `id` (string)
- `session_id` (string)
- `metric_type` (string)
- `metric_name` (string)
- `metric_value` (decimal(10,4))
- `metric_metadata` (map<string,string>)
- `aggregation_level` (string)
- `calculation_timestamp` (timestamp)
- `created_at` (timestamp)

---

### `analytics.group_analytics`

**Group/Student Related Columns:**
- `group_id` (string) - No comment

**Metrics Columns:**
- `member_count` (int) - No comment
- `completion_rate` (decimal(5,2)) - No comment
- `engagement_score` (decimal(5,2)) - No comment
- `participation_rate` (decimal(5,2)) - No comment
- `avg_collaboration_time` (decimal(10,2)) - No comment
- `total_messages` (int) - No comment
- `avg_message_length` (decimal(8,2)) - No comment
- `leader_engagement_score` (decimal(5,2)) - No comment

**All Columns:**
- `group_id` (string)
- `session_id` (string)
- `analysis_type` (string)
- `member_count` (int)
- `completion_rate` (decimal(5,2))
- `engagement_score` (decimal(5,2))
- `participation_rate` (decimal(5,2))
- `avg_collaboration_time` (decimal(10,2))
- `total_messages` (int)
- `avg_message_length` (decimal(8,2))
- `leader_engagement_score` (decimal(5,2))
- `computed_at` (timestamp)
- `created_at` (timestamp)
- `updated_at` (timestamp)

---

### `analytics.group_metrics`

**Group/Student Related Columns:**
- `group_id` (string) - No comment

**Metrics Columns:**
- `silent_members_count` (int) - No comment
- `turn_taking_score` (decimal(5,2)) - No comment
- `interruption_rate` (decimal(5,2)) - No comment
- `supportive_interactions_count` (int) - No comment
- `topic_coherence_score` (decimal(5,2)) - No comment
- `vocabulary_diversity_score` (decimal(5,2)) - No comment
- `academic_discourse_score` (decimal(5,2)) - No comment
- `average_sentiment_score` (decimal(5,2)) - No comment

**All Columns:**
- `id` (string)
- `group_id` (string)
- `session_id` (string)
- `calculation_timestamp` (timestamp)
- `participation_equality_index` (decimal(5,4))
- `dominant_speaker_percentage` (decimal(5,2))
- `silent_members_count` (int)
- `turn_taking_score` (decimal(5,2))
- `interruption_rate` (decimal(5,2))
- `supportive_interactions_count` (int)
- `topic_coherence_score` (decimal(5,2))
- `vocabulary_diversity_score` (decimal(5,2))
- `academic_discourse_score` (decimal(5,2))
- `average_sentiment_score` (decimal(5,2))
- `emotional_support_instances` (int)
- `conflict_instances` (int)
- `created_at` (timestamp)
- `configured_name` (string)
- `configured_size` (int)
- `leader_assigned` (boolean)
- `leader_ready_at` (timestamp)
- `members_configured` (int)
- `members_present` (int)

---

### `analytics.session_analytics`

**All Columns:**
- `id` (string)
- `session_id` (string)
- `analysis_type` (string)
- `status` (string)
- `computation_id` (string)
- `analytics_data` (string)
- `computation_metadata` (string)
- `started_at` (timestamp)
- `computed_at` (timestamp)
- `failed_at` (timestamp)
- `error_message` (string)
- `version` (string)
- `processing_time_ms` (bigint)
- `created_at` (timestamp)
- `updated_at` (timestamp)

---

### `analytics.session_analytics_cache`

**Group/Student Related Columns:**
- `planned_groups` (int) - No comment
- `actual_groups` (int) - No comment
- `total_students` (int) - No comment
- `active_students` (int) - No comment
- `ready_groups_at_start` (int) - No comment
- `ready_groups_at_5m` (int) - No comment
- `ready_groups_at_10m` (int) - No comment
- `avg_group_readiness_time` (double) - No comment

**Metrics Columns:**
- `total_students` (int) - No comment
- `avg_participation_rate` (double) - No comment
- `avg_group_readiness_time` (double) - No comment
- `total_transcriptions` (int) - No comment
- `avg_engagement_score` (double) - No comment
- `avg_collaboration_score` (double) - No comment

**All Columns:**
- `id` (string)
- `session_id` (string)
- `teacher_id` (string)
- `school_id` (string)
- `session_date` (date)
- `session_status` (string)
- `planned_groups` (int)
- `actual_groups` (int)
- `planned_duration_minutes` (int)
- `actual_duration_minutes` (int)
- `total_students` (int)
- `active_students` (int)
- `avg_participation_rate` (double)
- `ready_groups_at_start` (int)
- `ready_groups_at_5m` (int)
- `ready_groups_at_10m` (int)
- `avg_group_readiness_time` (double)
- `total_transcriptions` (int)
- `avg_engagement_score` (double)
- `avg_collaboration_score` (double)
- `cache_key` (string)
- `expires_at` (timestamp)
- `last_updated` (timestamp)
- `created_at` (timestamp)
- `session_date` (date)

---

### `analytics.session_events`

**All Columns:**
- `id` (string)
- `session_id` (string)
- `teacher_id` (string)
- `event_type` (string)
- `event_time` (timestamp)
- `payload` (string)
- `created_at` (timestamp)

---

### `analytics.session_metrics`

**Group/Student Related Columns:**
- `total_students` (int) - No comment
- `active_students` (int) - No comment
- `group_formation_time_seconds` (int) - No comment
- `average_group_size` (decimal(5,2)) - No comment
- `group_stability_score` (decimal(5,2)) - No comment
- `planned_groups` (int) - Number of groups configured by teacher
- `planned_group_size` (int) - Target group size configured by teacher
- `started_without_ready_groups` (boolean) - Whether session started before all groups were ready
- `ready_groups_at_start` (int) - Number of groups marked ready when session started
- `ready_groups_at_5m` (int) - Number of groups ready at 5 minutes
- `ready_groups_at_10m` (int) - Number of groups ready at 10 minutes

**Metrics Columns:**
- `total_students` (int) - No comment
- `participation_rate` (decimal(5,2)) - No comment
- `overall_engagement_score` (decimal(5,2)) - No comment
- `attention_score` (decimal(5,2)) - No comment
- `interaction_score` (decimal(5,2)) - No comment
- `collaboration_score` (decimal(5,2)) - No comment
- `question_asking_rate` (decimal(5,2)) - No comment
- `group_stability_score` (decimal(5,2)) - No comment
- `technical_issues_count` (int) - No comment

**All Columns:**
- `id` (string)
- `session_id` (string)
- `calculation_timestamp` (timestamp)
- `total_students` (int)
- `active_students` (int)
- `participation_rate` (decimal(5,2))
- `average_speaking_time_seconds` (decimal(10,2))
- `speaking_time_std_dev` (decimal(10,2))
- `overall_engagement_score` (decimal(5,2))
- `attention_score` (decimal(5,2))
- `interaction_score` (decimal(5,2))
- `collaboration_score` (decimal(5,2))
- `on_topic_percentage` (decimal(5,2))
- `academic_vocabulary_usage` (decimal(5,2))
- `question_asking_rate` (decimal(5,2))
- `group_formation_time_seconds` (int)
- `average_group_size` (decimal(5,2))
- `group_stability_score` (decimal(5,2))
- `average_connection_quality` (decimal(5,2))
- `technical_issues_count` (int)
- `created_at` (timestamp)
- `planned_groups` (int)
- `planned_group_size` (int)
- `planned_duration_minutes` (int)
- `planned_members` (int)
- `planned_leaders` (int)
- `planned_scheduled_start` (timestamp)
- `configured_at` (timestamp)
- `started_at` (timestamp)
- `started_without_ready_groups` (boolean)
- `ready_groups_at_start` (int)
- `ready_groups_at_5m` (int)
- `ready_groups_at_10m` (int)
- `adherence_members_ratio` (double)

---

### `analytics.student_metrics`

**Group/Student Related Columns:**
- `participant_id` (string) - No comment

**Metrics Columns:**
- `total_speaking_time_seconds` (int) - No comment
- `speaking_turns_count` (int) - No comment
- `participation_score` (decimal(5,2)) - No comment
- `initiative_score` (decimal(5,2)) - No comment
- `responsiveness_score` (decimal(5,2)) - No comment
- `vocabulary_complexity_score` (decimal(5,2)) - No comment
- `grammar_accuracy_score` (decimal(5,2)) - No comment
- `fluency_score` (decimal(5,2)) - No comment
- `peer_interaction_count` (int) - No comment
- `supportive_comments_count` (int) - No comment
- `questions_asked_count` (int) - No comment
- `stress_indicators_count` (int) - No comment

**All Columns:**
- `id` (string)
- `participant_id` (string)
- `session_id` (string)
- `calculation_timestamp` (timestamp)
- `total_speaking_time_seconds` (int)
- `speaking_turns_count` (int)
- `average_turn_duration_seconds` (decimal(10,2))
- `participation_score` (decimal(5,2))
- `initiative_score` (decimal(5,2))
- `responsiveness_score` (decimal(5,2))
- `vocabulary_complexity_score` (decimal(5,2))
- `grammar_accuracy_score` (decimal(5,2))
- `fluency_score` (decimal(5,2))
- `peer_interaction_count` (int)
- `supportive_comments_count` (int)
- `questions_asked_count` (int)
- `average_sentiment` (decimal(5,2))
- `confidence_level` (decimal(5,2))
- `stress_indicators_count` (int)
- `created_at` (timestamp)

---

### `analytics.teacher_analytics_summary`

**Metrics Columns:**
- `total_sessions` (int) - No comment
- `avg_session_score` (double) - No comment
- `avg_effectiveness_score` (double) - No comment
- `avg_participation_rate` (double) - No comment
- `total_session_duration_minutes` (int) - No comment
- `total_prompts_shown` (int) - No comment
- `total_prompts_used` (int) - No comment
- `total_prompts_dismissed` (int) - No comment
- `prompt_usage_rate` (double) - No comment
- `avg_prompt_response_time` (double) - No comment
- `avg_engagement_score` (double) - No comment
- `avg_collaboration_score` (double) - No comment
- `avg_critical_thinking_score` (double) - No comment
- `avg_discussion_quality_score` (double) - No comment
- `confidence_score` (double) - No comment
- `data_quality_score` (double) - No comment

**All Columns:**
- `id` (string)
- `teacher_id` (string)
- `school_id` (string)
- `summary_date` (date)
- `total_sessions` (int)
- `avg_session_score` (double)
- `avg_effectiveness_score` (double)
- `avg_participation_rate` (double)
- `total_session_duration_minutes` (int)
- `total_prompts_shown` (int)
- `total_prompts_used` (int)
- `total_prompts_dismissed` (int)
- `prompt_usage_rate` (double)
- `avg_prompt_response_time` (double)
- `avg_engagement_score` (double)
- `avg_collaboration_score` (double)
- `avg_critical_thinking_score` (double)
- `avg_discussion_quality_score` (double)
- `confidence_score` (double)
- `data_quality_score` (double)
- `calculation_method` (string)
- `source_tables` (string)
- `calculated_at` (timestamp)
- `created_at` (timestamp)
- `updated_at` (timestamp)
- `summary_date` (date)

---

### `operational.api_metrics`

**All Columns:**
- `id` (string)
- `endpoint` (string)
- `method` (string)
- `response_time_ms` (int)
- `status_code` (int)
- `user_id` (string)
- `school_id` (string)
- `ip_address` (string)
- `user_agent` (string)
- `timestamp` (timestamp)

---

### `sessions.classroom_sessions`

**Group/Student Related Columns:**
- `max_students` (int) - No comment
- `target_group_size` (int) - No comment
- `auto_group_enabled` (boolean) - No comment
- `total_groups` (int) - No comment
- `total_students` (int) - No comment

**Metrics Columns:**
- `total_groups` (int) - No comment
- `total_students` (int) - No comment
- `engagement_score` (decimal(5,2)) - No comment
- `participation_rate` (decimal(5,2)) - No comment

**All Columns:**
- `id` (string)
- `title` (string)
- `description` (string)
- `status` (string)
- `scheduled_start` (timestamp)
- `actual_start` (timestamp)
- `actual_end` (timestamp)
- `planned_duration_minutes` (int)
- `actual_duration_minutes` (int)
- `max_students` (int)
- `target_group_size` (int)
- `auto_group_enabled` (boolean)
- `teacher_id` (string)
- `school_id` (string)
- `recording_enabled` (boolean)
- `transcription_enabled` (boolean)
- `ai_analysis_enabled` (boolean)
- `ferpa_compliant` (boolean)
- `coppa_compliant` (boolean)
- `recording_consent_obtained` (boolean)
- `data_retention_date` (timestamp)
- `total_groups` (int)
- `total_students` (int)
- `created_at` (timestamp)
- `updated_at` (timestamp)
- `access_code` (string)
- `end_reason` (string)
- `teacher_notes` (string)
- `engagement_score` (decimal(5,2))
- `participation_rate` (decimal(5,2))

---

### `users.analytics_job_metadata`

**All Columns:**
- `job_name` (string)
- `processing_period` (timestamp)
- `last_run` (timestamp)
- `records_processed` (int)
- `status` (string)
- `error_message` (string)
- `execution_duration_seconds` (int)
- `created_at` (timestamp)
- `updated_at` (timestamp)

---

### `users.dashboard_metrics_hourly`

**Group/Student Related Columns:**
- `students_active` (int) - No comment

**Metrics Columns:**
- `avg_session_quality` (double) - No comment
- `avg_engagement_score` (double) - No comment
- `avg_participation_rate` (double) - No comment
- `avg_collaboration_score` (double) - No comment
- `avg_audio_quality` (double) - No comment
- `avg_connection_stability` (double) - No comment
- `total_errors` (int) - No comment
- `avg_response_time` (double) - No comment
- `total_prompts_generated` (int) - No comment
- `total_prompts_used` (int) - No comment
- `total_interventions` (int) - No comment
- `total_alerts` (int) - No comment
- `avg_ai_processing_time` (double) - No comment
- `ai_analysis_success_rate` (double) - No comment
- `total_transcription_minutes` (double) - No comment
- `total_storage_gb` (double) - No comment
- `data_sources_count` (int) - No comment

**All Columns:**
- `id` (string)
- `school_id` (string)
- `metric_hour` (timestamp)
- `sessions_active` (int)
- `sessions_completed` (int)
- `teachers_active` (int)
- `students_active` (int)
- `avg_session_quality` (double)
- `avg_engagement_score` (double)
- `avg_participation_rate` (double)
- `avg_collaboration_score` (double)
- `avg_audio_quality` (double)
- `avg_connection_stability` (double)
- `total_errors` (int)
- `avg_response_time` (double)
- `total_prompts_generated` (int)
- `total_prompts_used` (int)
- `total_interventions` (int)
- `total_alerts` (int)
- `ai_analyses_completed` (int)
- `avg_ai_processing_time` (double)
- `ai_analysis_success_rate` (double)
- `total_transcription_minutes` (double)
- `total_storage_gb` (double)
- `estimated_compute_cost` (double)
- `data_sources_count` (int)
- `calculation_method` (string)
- `calculated_at` (timestamp)

---

### `users.session_analytics_cache`

**Group/Student Related Columns:**
- `total_participants` (int) - No comment
- `planned_groups` (int) - No comment
- `actual_groups` (int) - No comment
- `group_completion_rate` (double) - No comment
- `groups_ready_at_start` (int) - No comment
- `groups_ready_at_5min` (int) - No comment
- `groups_ready_at_10min` (int) - No comment
- `avg_group_score` (double) - No comment

**Metrics Columns:**
- `session_overall_score` (double) - No comment
- `session_effectiveness_score` (double) - No comment
- `total_participants` (int) - No comment
- `group_completion_rate` (double) - No comment
- `participation_rate` (double) - No comment
- `avg_engagement_score` (double) - No comment
- `leader_readiness_rate` (double) - No comment
- `avg_readiness_time_minutes` (double) - No comment
- `avg_group_score` (double) - No comment
- `avg_critical_thinking_score` (double) - No comment
- `avg_participation_balance` (double) - No comment
- `total_ai_analyses` (int) - No comment
- `avg_ai_confidence` (double) - No comment
- `avg_audio_quality` (double) - No comment
- `avg_connection_stability` (double) - No comment
- `error_count` (int) - No comment
- `total_transcription_time` (double) - No comment
- `cache_hit_count` (int) - No comment
- `fallback_count` (int) - No comment

**All Columns:**
- `id` (string)
- `session_id` (string)
- `teacher_id` (string)
- `school_id` (string)
- `session_date` (date)
- `session_status` (string)
- `session_overall_score` (double)
- `session_effectiveness_score` (double)
- `session_duration_minutes` (int)
- `total_participants` (int)
- `planned_groups` (int)
- `actual_groups` (int)
- `group_completion_rate` (double)
- `participation_rate` (double)
- `avg_engagement_score` (double)
- `leader_readiness_rate` (double)
- `avg_readiness_time_minutes` (double)
- `groups_ready_at_start` (int)
- `groups_ready_at_5min` (int)
- `groups_ready_at_10min` (int)
- `avg_group_score` (double)
- `avg_critical_thinking_score` (double)
- `avg_participation_balance` (double)
- `total_ai_analyses` (int)
- `avg_ai_confidence` (double)
- `key_insights` (string)
- `intervention_recommendations` (string)
- `leader_ready_events` (string)
- `intervention_events` (string)
- `avg_audio_quality` (double)
- `avg_connection_stability` (double)
- `error_count` (int)
- `total_transcription_time` (double)
- `cache_freshness` (string)
- `last_real_time_update` (timestamp)
- `last_full_calculation` (timestamp)
- `cache_hit_count` (int)
- `fallback_count` (int)
- `cached_at` (timestamp)

---

### `users.teacher_analytics_summary`

**Group/Student Related Columns:**
- `avg_group_completion_rate` (double) - No comment
- `avg_group_readiness_time` (double) - No comment

**Metrics Columns:**
- `total_sessions` (int) - No comment
- `avg_session_score` (double) - No comment
- `avg_effectiveness_score` (double) - No comment
- `avg_participation_rate` (double) - No comment
- `total_session_duration_minutes` (int) - No comment
- `total_prompts_shown` (int) - No comment
- `total_prompts_used` (int) - No comment
- `total_prompts_dismissed` (int) - No comment
- `prompt_usage_rate` (double) - No comment
- `avg_prompt_response_time` (double) - No comment
- `avg_engagement_score` (double) - No comment
- `avg_collaboration_score` (double) - No comment
- `avg_critical_thinking_score` (double) - No comment
- `avg_discussion_quality_score` (double) - No comment
- `total_interventions` (int) - No comment
- `avg_intervention_rate` (double) - No comment
- `total_alerts_generated` (int) - No comment
- `avg_alert_response_time` (double) - No comment
- `avg_group_completion_rate` (double) - No comment
- `total_leader_ready_events` (int) - No comment
- `avg_group_readiness_time` (double) - No comment
- `confidence_score` (double) - No comment

**All Columns:**
- `id` (string)
- `teacher_id` (string)
- `school_id` (string)
- `summary_date` (date)
- `total_sessions` (int)
- `avg_session_score` (double)
- `avg_effectiveness_score` (double)
- `avg_participation_rate` (double)
- `total_session_duration_minutes` (int)
- `total_prompts_shown` (int)
- `total_prompts_used` (int)
- `total_prompts_dismissed` (int)
- `prompt_usage_rate` (double)
- `avg_prompt_response_time` (double)
- `avg_engagement_score` (double)
- `avg_collaboration_score` (double)
- `avg_critical_thinking_score` (double)
- `avg_discussion_quality_score` (double)
- `total_interventions` (int)
- `avg_intervention_rate` (double)
- `total_alerts_generated` (int)
- `avg_alert_response_time` (double)
- `vs_peer_average` (double)
- `vs_school_average` (double)
- `improvement_trend` (string)
- `avg_group_completion_rate` (double)
- `total_leader_ready_events` (int)
- `avg_group_readiness_time` (double)
- `data_points_included` (int)
- `confidence_score` (double)
- `calculated_at` (timestamp)
- `last_updated` (timestamp)

---

## Recommendations for session.controller.ts

Based on the schema analysis, here are the recommended data flows:

### 1. Primary Session Data
- **Table:** `sessions.classroom_sessions`
- **Purpose:** Main session record with basic info and group counts
- **Key Columns:** Look for `total_groups`, `max_students`, etc.

### 2. Session Metrics
- **Table:** `users.session_metrics` (if exists)
- **Purpose:** Calculated metrics and analytics
- **Key Columns:** Derived metrics, scores, rates

### 3. Session Events
- **Table:** `analytics.session_events`
- **Purpose:** Timeline of session events
- **Key Columns:** Event tracking, timestamps

### 4. Analytics Cache
- **Table:** `users.session_analytics_cache`
- **Purpose:** Pre-calculated analytics for performance
- **Key Columns:** Cached metrics, aggregated data

## Action Items

1. **Fix Column References:** Update session.controller.ts to use correct column names
2. **Data Flow Mapping:** Map each metric to its proper table
3. **Validation:** Ensure all referenced columns actually exist
4. **Testing:** Verify data flows work end-to-end


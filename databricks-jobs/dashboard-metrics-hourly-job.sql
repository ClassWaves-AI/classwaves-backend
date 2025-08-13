-- ============================================================================
-- Dashboard Metrics Hourly Rollup Job
-- ============================================================================
-- 
-- Databricks Job Configuration:
-- - Schedule: Hourly (0 * * * *) 
-- - Cluster: Job cluster with 1 node, auto-terminate after 5 minutes
-- - Target: 90% query time reduction, 85% cost reduction
-- - Expected runtime: 2-5 minutes
-- - Expected savings: 25.5GB data scanning reduction per dashboard query
--
-- Setup Instructions:
-- 1. Create new Databricks Job
-- 2. Set SQL task with this query
-- 3. Configure schedule: "0 * * * *" (every hour)
-- 4. Set cluster policy: XSmall (1-2 cores, auto-terminate)
-- 5. Enable Slack alerts on failure
-- ============================================================================

-- Get the previous hour for processing
SET previous_hour = date_trunc('hour', current_timestamp() - INTERVAL 1 HOUR);

-- Insert or update dashboard metrics for the previous hour
INSERT OVERWRITE dashboard_metrics_hourly
SELECT 
  concat('dmh_', school_id, '_', date_format(${previous_hour}, 'yyyyMMddHH')) as id,
  school_id,
  ${previous_hour} as metric_hour,
  
  -- Active Session Metrics
  count(distinct case when status = 'active' then session_id end) as sessions_active,
  count(distinct case when status = 'completed' then session_id end) as sessions_completed,
  count(distinct teacher_id) as teachers_active,
  sum(total_participants) as students_active,
  
  -- Quality Metrics (Hourly Averages)
  avg(session_overall_score) as avg_session_quality,
  avg(overall_engagement_score) as avg_engagement_score,
  avg(participation_rate) as avg_participation_rate,
  avg(collaboration_score) as avg_collaboration_score,
  
  -- System Health (Hourly Averages)
  avg(audio_quality_score) as avg_audio_quality,
  avg(connection_stability) as avg_connection_stability,
  sum(error_count) as total_errors,
  avg(latency_average) as avg_response_time,
  
  -- Activity Metrics
  sum(total_prompts_shown) as total_prompts_generated,
  sum(total_prompts_used) as total_prompts_used,
  sum(total_interventions) as total_interventions,
  sum(conflict_alerts + confusion_indicators + disengagement_signals) as total_alerts,
  
  -- AI Analysis Metrics
  count(case when analysis_type = 'real_time' then 1 end) as ai_analyses_completed,
  avg(processing_time_seconds) as avg_ai_processing_time,
  avg(case when analysis_confidence > 0.8 then 1.0 else 0.0 end) as ai_analysis_success_rate,
  
  -- Resource Usage (Estimated)
  sum(session_duration_minutes) as total_transcription_minutes,
  sum(session_duration_minutes * 0.1) as total_storage_gb, -- Estimated
  sum(session_duration_minutes * 0.05) as estimated_compute_cost, -- Estimated $0.05 per minute
  
  -- Metadata
  count(*) as data_sources_count,
  'hourly_rollup' as calculation_method,
  current_timestamp() as calculated_at
  
FROM (
  SELECT 
    sa.*,
    cs.status,
    cs.teacher_id,
    coalesce(cs.school_id, t.school_id) as school_id
  FROM session_analytics sa
  JOIN classroom_sessions cs ON sa.session_id = cs.id
  LEFT JOIN teachers t ON cs.teacher_id = t.id
  WHERE sa.analysis_timestamp >= ${previous_hour} 
    AND sa.analysis_timestamp < ${previous_hour} + INTERVAL 1 HOUR
    AND coalesce(cs.school_id, t.school_id) IS NOT NULL
) combined_data
GROUP BY school_id;

-- Update metadata table with job execution info
MERGE INTO analytics_job_metadata target
USING (
  SELECT 
    'dashboard_metrics_hourly' as job_name,
    ${previous_hour} as processing_period,
    current_timestamp() as last_run,
    (SELECT count(*) FROM dashboard_metrics_hourly WHERE metric_hour = ${previous_hour}) as records_processed,
    'completed' as status
) source
ON target.job_name = source.job_name AND target.processing_period = source.processing_period
WHEN MATCHED THEN UPDATE SET *
WHEN NOT MATCHED THEN INSERT *;

-- Log successful completion
INSERT INTO audit_logs (
  user_id,
  action,
  resource_type,
  resource_id,
  timestamp,
  metadata
) VALUES (
  'system-databricks-job',
  'dashboard_metrics_hourly_rollup',
  'analytics_job',
  concat('job_', date_format(${previous_hour}, 'yyyy-MM-dd-HH')),
  current_timestamp(),
  concat('{"hour": "', ${previous_hour}, '", "schools_processed": ', 
    (SELECT count(distinct school_id) FROM dashboard_metrics_hourly WHERE metric_hour = ${previous_hour}), '}')
);

-- Display job results for monitoring
SELECT 
  'Dashboard Metrics Hourly Rollup' as job_name,
  ${previous_hour} as processing_hour,
  count(distinct school_id) as schools_processed,
  sum(sessions_active) as total_sessions_active,
  sum(sessions_completed) as total_sessions_completed,
  sum(teachers_active) as total_teachers_active,
  sum(students_active) as total_students_active,
  avg(avg_session_quality) as avg_quality_score,
  sum(total_prompts_generated) as total_prompts,
  sum(ai_analyses_completed) as total_ai_analyses,
  sum(estimated_compute_cost) as estimated_cost,
  current_timestamp() as completed_at
FROM dashboard_metrics_hourly 
WHERE metric_hour = ${previous_hour};

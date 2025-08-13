-- ============================================================================
-- Teacher Analytics Daily Aggregation Job
-- ============================================================================
-- 
-- Databricks Job Configuration:
-- - Schedule: Daily at 2:00 AM UTC (0 2 * * *)
-- - Cluster: Job cluster with 1-2 nodes, auto-terminate after 10 minutes
-- - Target: 85% query time reduction, 80% cost reduction
-- - Expected runtime: 5-15 minutes
-- - Expected savings: 20GB data scanning reduction per teacher query
--
-- Setup Instructions:
-- 1. Create new Databricks Job
-- 2. Set SQL task with this query
-- 3. Configure schedule: "0 2 * * *" (daily at 2 AM)
-- 4. Set cluster policy: Small (2-8 cores, auto-terminate)
-- 5. Enable email alerts on failure
-- ============================================================================

-- Get yesterday's date for processing
SET yesterday = current_date() - INTERVAL 1 DAY;

-- Insert or update teacher analytics summary for yesterday
INSERT OVERWRITE teacher_analytics_summary
SELECT 
  concat('tas_', t.id, '_', date_format(${yesterday}, 'yyyy-MM-dd')) as id,
  t.id as teacher_id,
  t.school_id,
  ${yesterday} as summary_date,
  
  -- Session Metrics (Pre-aggregated)
  coalesce(sm.total_sessions, 0) as total_sessions,
  coalesce(sm.avg_session_score, 0) as avg_session_score,
  coalesce(sm.avg_effectiveness_score, 0) as avg_effectiveness_score,
  coalesce(sm.avg_participation_rate, 0) as avg_participation_rate,
  coalesce(sm.total_duration_minutes, 0) as total_session_duration_minutes,
  
  -- Prompt Metrics (Pre-aggregated)
  coalesce(pm.total_prompts_shown, 0) as total_prompts_shown,
  coalesce(pm.total_prompts_used, 0) as total_prompts_used,
  coalesce(pm.total_prompts_dismissed, 0) as total_prompts_dismissed,
  case when pm.total_prompts_shown > 0 then 
    pm.total_prompts_used * 100.0 / pm.total_prompts_shown 
  else 0 end as prompt_usage_rate,
  coalesce(pm.avg_response_time, 0) as avg_prompt_response_time,
  
  -- Engagement Metrics (Pre-aggregated)
  coalesce(em.avg_engagement_score, 0) as avg_engagement_score,
  coalesce(em.avg_collaboration_score, 0) as avg_collaboration_score,
  coalesce(em.avg_critical_thinking_score, 0) as avg_critical_thinking_score,
  coalesce(em.avg_discussion_quality_score, 0) as avg_discussion_quality_score,
  
  -- Intervention Metrics (Pre-aggregated)
  coalesce(im.total_interventions, 0) as total_interventions,
  coalesce(im.avg_intervention_rate, 0) as avg_intervention_rate,
  coalesce(im.total_alerts, 0) as total_alerts_generated,
  coalesce(im.avg_response_time, 0) as avg_alert_response_time,
  
  -- Comparative Metrics (Pre-calculated)
  coalesce(cm.vs_peer_average, 0) as vs_peer_average,
  coalesce(cm.vs_school_average, 0) as vs_school_average,
  cm.improvement_trend,
  
  -- Group Performance (Pre-aggregated)
  coalesce(gm.avg_completion_rate, 0) as avg_group_completion_rate,
  coalesce(gm.total_leader_ready_events, 0) as total_leader_ready_events,
  coalesce(gm.avg_readiness_time, 0) as avg_group_readiness_time,
  
  -- Metadata
  coalesce(sm.total_sessions, 0) + coalesce(pm.data_points, 0) as data_points_included,
  0.95 as confidence_score, -- Default confidence
  current_timestamp() as calculated_at,
  current_timestamp() as last_updated
  
FROM teachers t

-- Session Metrics CTE
LEFT JOIN (
  SELECT 
    teacher_id,
    count(distinct id) as total_sessions,
    avg(session_overall_score) as avg_session_score,
    avg(session_effectiveness_score) as avg_effectiveness_score,
    avg(participation_rate) as avg_participation_rate,
    sum(session_duration_minutes) as total_duration_minutes
  FROM session_analytics sa
  WHERE date(sa.analysis_timestamp) = ${yesterday}
  GROUP BY teacher_id
) sm ON t.id = sm.teacher_id

-- Prompt Metrics CTE
LEFT JOIN (
  SELECT 
    teacher_id,
    sum(total_prompts_shown) as total_prompts_shown,
    sum(total_prompts_used) as total_prompts_used,
    sum(total_prompts_shown - total_prompts_used) as total_prompts_dismissed,
    avg(avg_response_time_seconds) as avg_response_time,
    count(*) as data_points
  FROM session_analytics sa
  WHERE date(sa.analysis_timestamp) = ${yesterday}
  GROUP BY teacher_id
) pm ON t.id = pm.teacher_id

-- Engagement Metrics CTE
LEFT JOIN (
  SELECT 
    sa.teacher_id,
    avg(sa.overall_engagement_score) as avg_engagement_score,
    avg(sa.collaboration_score) as avg_collaboration_score,
    avg(sa.critical_thinking_score) as avg_critical_thinking_score,
    avg(ga.discussion_quality_score) as avg_discussion_quality_score
  FROM session_analytics sa
  LEFT JOIN group_analytics ga ON sa.session_id = ga.session_id
  WHERE date(sa.analysis_timestamp) = ${yesterday}
  GROUP BY sa.teacher_id
) em ON t.id = em.teacher_id

-- Intervention Metrics CTE
LEFT JOIN (
  SELECT 
    teacher_id,
    sum(total_interventions) as total_interventions,
    avg(intervention_rate) as avg_intervention_rate,
    sum(conflict_alerts + confusion_indicators + disengagement_signals) as total_alerts,
    avg(alert_response_time_seconds) as avg_response_time
  FROM session_analytics sa
  WHERE date(sa.analysis_timestamp) = ${yesterday}
  GROUP BY teacher_id
) im ON t.id = im.teacher_id

-- Comparative Metrics CTE (simplified for now)
LEFT JOIN (
  SELECT 
    teacher_id,
    vs_teacher_average as vs_peer_average,
    vs_school_average,
    case 
      when vs_teacher_average > 1.05 then 'improving'
      when vs_teacher_average < 0.95 then 'declining'
      else 'stable'
    end as improvement_trend
  FROM session_analytics sa
  WHERE date(sa.analysis_timestamp) = ${yesterday}
  GROUP BY teacher_id, vs_teacher_average, vs_school_average
) cm ON t.id = cm.teacher_id

-- Group Metrics CTE
LEFT JOIN (
  SELECT 
    sa.teacher_id,
    avg(case when sa.planned_groups > 0 then 
      sa.actual_groups * 100.0 / sa.planned_groups 
    else 0 end) as avg_completion_rate,
    count(se.id) as total_leader_ready_events,
    avg(timestampdiff(minute, sa.started_at, se.event_time)) as avg_readiness_time
  FROM session_analytics sa
  LEFT JOIN session_events se ON sa.session_id = se.session_id 
    AND se.event_type = 'leader_ready'
  WHERE date(sa.analysis_timestamp) = ${yesterday}
  GROUP BY sa.teacher_id
) gm ON t.id = gm.teacher_id

WHERE t.status = 'active'
  AND (sm.teacher_id IS NOT NULL OR pm.teacher_id IS NOT NULL);

-- Log job completion
INSERT INTO audit_logs (
  user_id,
  action,
  resource_type,
  resource_id,
  timestamp,
  metadata
) VALUES (
  'system-databricks-job',
  'teacher_analytics_daily_aggregation',
  'analytics_job',
  concat('job_', date_format(current_timestamp(), 'yyyy-MM-dd')),
  current_timestamp(),
  concat('{"date": "', ${yesterday}, '", "records_processed": ', 
    (SELECT count(*) FROM teacher_analytics_summary WHERE summary_date = ${yesterday}), '}')
);

-- Display job results
SELECT 
  'Teacher Analytics Daily Aggregation' as job_name,
  ${yesterday} as processing_date,
  count(*) as teachers_processed,
  sum(total_sessions) as total_sessions_aggregated,
  sum(data_points_included) as total_data_points,
  avg(confidence_score) as avg_confidence,
  current_timestamp() as completed_at
FROM teacher_analytics_summary 
WHERE summary_date = ${yesterday};

-- ============================================================================
-- Session Analytics Cache Maintenance Job
-- ============================================================================
-- 
-- Databricks Job Configuration:
-- - Schedule: Every 10 minutes (*/10 * * * *)
-- - Cluster: Job cluster with 1 node, auto-terminate after 3 minutes
-- - Target: 70% query time reduction, 60% cost reduction
-- - Expected runtime: 1-3 minutes
-- - Expected savings: 7.2GB data scanning reduction per session query
--
-- Setup Instructions:
-- 1. Create new Databricks Job
-- 2. Set SQL task with this query  
-- 3. Configure schedule: "*/10 * * * *" (every 10 minutes)
-- 4. Set cluster policy: XSmall (1 core, auto-terminate)
-- 5. Set timeout: 5 minutes
-- ============================================================================

-- Get current time window (last 15 minutes to catch any late-arriving data)
SET processing_window_start = current_timestamp() - INTERVAL 15 MINUTES;
SET processing_window_end = current_timestamp();

-- Merge updated session analytics into cache
MERGE INTO session_analytics_cache target
USING (
  SELECT 
    concat('sac_', sa.session_id, '_', date_format(sa.analysis_timestamp, 'yyyyMMddHHmm')) as id,
    sa.session_id,
    sa.teacher_id,
    coalesce(cs.school_id, t.school_id) as school_id,
    date(sa.analysis_timestamp) as session_date,
    
    -- Session Overview (Cached)
    cs.status as session_status,
    sa.session_overall_score,
    sa.session_effectiveness_score,
    sa.session_duration_minutes,
    sa.total_participants,
    
    -- Planned vs Actual (Cached)
    sa.planned_groups,
    count(distinct ga.group_id) as actual_groups,
    case when sa.planned_groups > 0 then 
      count(distinct ga.group_id) * 100.0 / sa.planned_groups 
    else 0 end as group_completion_rate,
    
    -- Participation Metrics (Cached)
    sa.participation_rate,
    sa.overall_engagement_score as avg_engagement_score,
    avg(case when ga.is_ready then 1.0 else 0.0 end) as leader_readiness_rate,
    avg(ga.avg_readiness_time_minutes) as avg_readiness_time_minutes,
    
    -- Group Performance (Pre-aggregated from group_analytics)
    sum(case when ga.ready_at_start then 1 else 0 end) as groups_ready_at_start,
    sum(case when ga.ready_at_5min then 1 else 0 end) as groups_ready_at_5min,
    sum(case when ga.ready_at_10min then 1 else 0 end) as groups_ready_at_10min,
    avg(ga.overall_score) as avg_group_score,
    avg(ga.critical_thinking_score) as avg_critical_thinking_score,
    avg(ga.participation_balance_score) as avg_participation_balance,
    
    -- AI Analysis Summary (Cached)
    sa.total_analyses as total_ai_analyses,
    sa.analysis_confidence as avg_ai_confidence,
    
    -- Simplified JSON aggregations (can be enhanced later)
    '[]' as key_insights, -- TODO: Aggregate key insights from AI analysis
    '[]' as intervention_recommendations, -- TODO: Aggregate recommendations
    
    -- Event Timeline (Simplified)
    concat('[{"type": "session_started", "timestamp": "', sa.started_at, '"}]') as leader_ready_events,
    '[]' as intervention_events, -- TODO: Aggregate intervention events
    
    -- Technical Metrics (Cached)
    sa.audio_quality_score as avg_audio_quality,
    sa.connection_stability as avg_connection_stability,
    sa.error_count,
    sa.processing_time_seconds as total_transcription_time,
    
    -- Cache Metadata
    case 
      when cs.status = 'completed' then 'fresh'
      when sa.analysis_timestamp > current_timestamp() - INTERVAL 30 MINUTES then 'fresh'
      else 'stale'
    end as cache_freshness,
    
    case when sa.analysis_type = 'real_time' then current_timestamp() else null end as last_real_time_update,
    sa.analysis_timestamp as last_full_calculation,
    0 as cache_hit_count, -- Will be updated by application
    0 as fallback_count,  -- Will be updated by application
    current_timestamp() as cached_at
    
  FROM session_analytics sa
  JOIN classroom_sessions cs ON sa.session_id = cs.id
  LEFT JOIN teachers t ON cs.teacher_id = t.id
  LEFT JOIN group_analytics ga ON sa.session_id = ga.session_id
  
  WHERE sa.analysis_timestamp >= ${processing_window_start}
    AND sa.analysis_timestamp <= ${processing_window_end}
    AND coalesce(cs.school_id, t.school_id) IS NOT NULL
    AND (cs.status = 'completed' OR sa.analysis_type = 'end_of_session' OR sa.analysis_type = 'real_time')
  
  GROUP BY 
    sa.session_id, sa.teacher_id, cs.school_id, t.school_id, sa.analysis_timestamp,
    cs.status, sa.session_overall_score, sa.session_effectiveness_score,
    sa.session_duration_minutes, sa.total_participants, sa.planned_groups,
    sa.participation_rate, sa.overall_engagement_score, sa.total_analyses,
    sa.analysis_confidence, sa.started_at, sa.audio_quality_score,
    sa.connection_stability, sa.error_count, sa.processing_time_seconds, sa.analysis_type
    
) source
ON target.session_id = source.session_id
WHEN MATCHED THEN UPDATE SET 
  session_status = source.session_status,
  session_overall_score = source.session_overall_score,
  session_effectiveness_score = source.session_effectiveness_score,
  actual_groups = source.actual_groups,
  group_completion_rate = source.group_completion_rate,
  avg_engagement_score = source.avg_engagement_score,
  leader_readiness_rate = source.leader_readiness_rate,
  groups_ready_at_start = source.groups_ready_at_start,
  groups_ready_at_5min = source.groups_ready_at_5min,
  groups_ready_at_10min = source.groups_ready_at_10min,
  avg_group_score = source.avg_group_score,
  total_ai_analyses = source.total_ai_analyses,
  avg_ai_confidence = source.avg_ai_confidence,
  cache_freshness = source.cache_freshness,
  last_real_time_update = source.last_real_time_update,
  last_full_calculation = source.last_full_calculation,
  cached_at = source.cached_at
WHEN NOT MATCHED THEN INSERT *;

-- Clean up stale cache entries (older than 24 hours)
UPDATE session_analytics_cache 
SET cache_freshness = 'stale'
WHERE cached_at < current_timestamp() - INTERVAL 24 HOURS
  AND cache_freshness = 'fresh';

-- Delete very old cache entries (older than 7 days) to save space
DELETE FROM session_analytics_cache 
WHERE cached_at < current_timestamp() - INTERVAL 7 DAYS;

-- Update cache hit statistics (placeholder - will be updated by application)
UPDATE session_analytics_cache 
SET cache_hit_count = cache_hit_count + 1
WHERE session_id IN (
  SELECT DISTINCT session_id 
  FROM session_analytics 
  WHERE analysis_timestamp >= ${processing_window_start}
    AND analysis_timestamp <= ${processing_window_end}
) AND cache_freshness = 'fresh';

-- Log job execution
INSERT INTO audit_logs (
  user_id,
  action,
  resource_type,
  resource_id,
  timestamp,
  metadata
) VALUES (
  'system-databricks-job',
  'session_cache_maintenance',
  'analytics_job',
  concat('job_', date_format(current_timestamp(), 'yyyy-MM-dd-HH-mm')),
  current_timestamp(),
  concat('{"window_start": "', ${processing_window_start}, '", "window_end": "', ${processing_window_end}, 
    '", "sessions_processed": ', 
    (SELECT count(*) FROM session_analytics_cache 
     WHERE cached_at >= ${processing_window_start}), '}')
);

-- Display job results
SELECT 
  'Session Cache Maintenance' as job_name,
  ${processing_window_start} as window_start,
  ${processing_window_end} as window_end,
  count(case when cached_at >= ${processing_window_start} then 1 end) as sessions_updated,
  count(case when cache_freshness = 'fresh' then 1 end) as fresh_cache_entries,
  count(case when cache_freshness = 'stale' then 1 end) as stale_cache_entries,
  avg(case when cache_freshness = 'fresh' then session_overall_score end) as avg_session_quality,
  avg(case when cache_freshness = 'fresh' then group_completion_rate end) as avg_group_completion,
  current_timestamp() as completed_at
FROM session_analytics_cache;

/**
 * Analytics Monitoring Controller
 * 
 * Provides endpoints for monitoring analytics write performance and health.
 * Used for observability and performance tracking of analytics operations.
 */

import { Request, Response } from 'express';
import { AuthRequest } from '../types/auth.types';
import { analyticsLogger } from '../utils/analytics-logger';
import { queryCostMonitorService } from '../services/query-cost-monitor.service';

/**
 * GET /api/v1/analytics/monitoring/performance
 * 
 * Get analytics operation performance metrics
 * Admin access only
 */
export const getAnalyticsPerformance = async (req: Request, res: Response): Promise<Response> => {
  try {
    const authReq = req as AuthRequest;
    const user = authReq.user;
    
    // Verify admin access
    if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
      return res.status(403).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Admin access required'
      });
    }

    const report = analyticsLogger.generatePerformanceReport();
    
    return res.json({
      success: true,
      data: {
        performance: report,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'unknown'
      }
    });
  } catch (error) {
    logger.error('Failed to get analytics performance:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to retrieve analytics performance metrics'
    });
  }
};

/**
 * GET /api/v1/analytics/monitoring/logs
 * 
 * Get recent analytics operation logs
 * Admin access only
 */
export const getAnalyticsLogs = async (req: Request, res: Response): Promise<Response> => {
  try {
    const authReq = req as AuthRequest;
    const user = authReq.user;
    
    // Verify admin access
    if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
      return res.status(403).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Admin access required'
      });
    }

    const { operation, table, sessionId, limit, since } = req.query;
    
    const logs = analyticsLogger.getRecentLogs({
      operation: operation as string,
      table: table as string,
      sessionId: sessionId as string,
      limit: limit ? parseInt(limit as string) : 100,
      since: since ? new Date(since as string) : new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
    });
    
    return res.json({
      success: true,
      data: {
        logs,
        totalCount: logs.length,
        filters: {
          operation: operation || null,
          table: table || null,
          sessionId: sessionId || null,
          limit: limit ? parseInt(limit as string) : 100,
          since: since || 'last 24 hours'
        },
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Failed to get analytics logs:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to retrieve analytics logs'
    });
  }
};

/**
 * GET /api/v1/analytics/monitoring/health
 * 
 * Get analytics system health status
 * Admin access only
 */
export const getAnalyticsHealth = async (req: Request, res: Response): Promise<Response> => {
  try {
    const authReq = req as AuthRequest;
    const user = authReq.user;
    
    // Verify admin access
    if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
      return res.status(403).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Admin access required'
      });
    }

    const report = analyticsLogger.generatePerformanceReport();
    const recentErrors = analyticsLogger.getRecentLogs({ 
      limit: 10,
      since: new Date(Date.now() - 60 * 60 * 1000) // Last hour
    }).filter(log => !log.success);

    // Determine overall health status
    let healthStatus = 'healthy';
    const { summary } = report;
    
    if (summary.overallSuccessRate < 0.95) {
      healthStatus = 'degraded';
    }
    if (summary.overallSuccessRate < 0.90 || summary.averageDuration > 5000) {
      healthStatus = 'unhealthy';
    }
    if (summary.totalOperations === 0) {
      healthStatus = 'unknown';
    }

    // Calculate health metrics
    const healthMetrics = {
      status: healthStatus,
      successRate: summary.overallSuccessRate,
      averageResponseTime: summary.averageDuration,
      totalOperations: summary.totalOperations,
      slowOperations: summary.slowOperations,
      recentErrorCount: recentErrors.length,
      recommendations: report.recommendations,
      lastUpdated: new Date().toISOString()
    };

    return res.json({
      success: true,
      data: {
        health: healthMetrics,
        details: {
          operationBreakdown: report.operationBreakdown,
          recentErrors: recentErrors.slice(0, 5), // Only show top 5 recent errors
        },
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Failed to get analytics health:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to retrieve analytics health status'
    });
  }
};

/**
 * POST /api/v1/analytics/monitoring/sample-rate
 * 
 * Update analytics logging sample rate
 * Admin access only
 */
export const updateSampleRate = async (req: Request, res: Response): Promise<Response> => {
  try {
    const authReq = req as AuthRequest;
    const user = authReq.user;
    
    // Verify admin access
    if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
      return res.status(403).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Admin access required'
      });
    }

    const { sampleRate } = req.body;
    
    if (typeof sampleRate !== 'number' || sampleRate < 0 || sampleRate > 1) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_SAMPLE_RATE',
        message: 'Sample rate must be a number between 0 and 1'
      });
    }

    analyticsLogger.setSampleRate(sampleRate);
    
    return res.json({
      success: true,
      data: {
        sampleRate,
        message: `Analytics logging sample rate updated to ${sampleRate * 100}%`,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Failed to update sample rate:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to update analytics sample rate'
    });
  }
};

/**
 * POST /api/v1/analytics/monitoring/cleanup
 * 
 * Trigger analytics log cleanup
 * Admin access only
 */
export const triggerCleanup = async (req: Request, res: Response): Promise<Response> => {
  try {
    const authReq = req as AuthRequest;
    const user = authReq.user;
    
    // Verify admin access
    if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
      return res.status(403).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Admin access required'
      });
    }

    const { olderThanHours = 24 } = req.body;
    const cutoffDate = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
    
    analyticsLogger.cleanup(cutoffDate);
    
    return res.json({
      success: true,
      data: {
        message: `Analytics log cleanup completed for entries older than ${olderThanHours} hours`,
        cutoffDate: cutoffDate.toISOString(),
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Failed to trigger cleanup:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to trigger analytics log cleanup'
    });
  }
};

/**
 * GET /api/v1/analytics/monitoring/cost-analysis
 * 
 * Get query cost analysis and optimization recommendations
 * Admin access only
 */
export const getCostAnalysis = async (req: Request, res: Response): Promise<Response> => {
  try {
    const authReq = req as AuthRequest;
    const user = authReq.user;
    
    // Verify admin access
    if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
      return res.status(403).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Admin access required'
      });
    }

    const { timeframeHours = 24 } = req.query;
    const timeframe = parseInt(timeframeHours as string);
    
    if (isNaN(timeframe) || timeframe < 1 || timeframe > 168) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_TIMEFRAME',
        message: 'Timeframe must be between 1 and 168 hours'
      });
    }

    const costAnalysis = queryCostMonitorService.getCostAnalysis(timeframe);
    const optimizationReport = queryCostMonitorService.getOptimizationReport();
    const costAlerts = queryCostMonitorService.checkCostAlerts();
    
    return res.json({
      success: true,
      data: {
        costAnalysis,
        optimizationReport,
        alerts: costAlerts,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Failed to get cost analysis:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to retrieve cost analysis'
    });
  }
};

// Aggregation status is now handled by Databricks Jobs UI
// Use Databricks workspace to monitor job execution status

// Job triggering is now handled by Databricks Jobs UI
// Use "Run now" button in Databricks workspace to manually trigger jobs

/**
 * POST /api/v1/analytics/monitoring/setup-tables
 * 
 * Create pre-aggregated tables in Databricks
 * Admin access only - for initial setup
 */
export const setupPreAggregatedTables = async (req: Request, res: Response): Promise<Response> => {
  try {
    const authReq = req as AuthRequest;
    const user = authReq.user;
    
    // Verify admin access
    if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
      return res.status(403).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Admin access required'
      });
    }

    logger.debug('🔧 Setting up pre-aggregated tables...');
    
    // Import databricks here to ensure environment is loaded
    const { databricksService } = await import('../services/databricks.service');
    
    // Test connection first
    try {
      await databricksService.connect();
      logger.debug('✅ Databricks connection successful');
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: 'DATABRICKS_CONNECTION_FAILED',
        message: error instanceof Error ? error.message : 'Failed to connect to Databricks'
      });
    }

    // Define tables to create
    const tables = [
      {
        name: 'teacher_analytics_summary',
        sql: `
          CREATE TABLE IF NOT EXISTS teacher_analytics_summary (
            id STRING NOT NULL,
            teacher_id STRING NOT NULL,
            school_id STRING NOT NULL,
            summary_date DATE NOT NULL,
            total_sessions INT DEFAULT 0,
            avg_session_score DOUBLE DEFAULT 0,
            avg_effectiveness_score DOUBLE DEFAULT 0,
            avg_participation_rate DOUBLE DEFAULT 0,
            total_session_duration_minutes INT DEFAULT 0,
            total_prompts_shown INT DEFAULT 0,
            total_prompts_used INT DEFAULT 0,
            total_prompts_dismissed INT DEFAULT 0,
            prompt_usage_rate DOUBLE DEFAULT 0,
            avg_prompt_response_time DOUBLE DEFAULT 0,
            avg_engagement_score DOUBLE DEFAULT 0,
            avg_collaboration_score DOUBLE DEFAULT 0,
            avg_critical_thinking_score DOUBLE DEFAULT 0,
            avg_discussion_quality_score DOUBLE DEFAULT 0,
            total_interventions INT DEFAULT 0,
            avg_intervention_rate DOUBLE DEFAULT 0,
            total_alerts_generated INT DEFAULT 0,
            avg_alert_response_time DOUBLE DEFAULT 0,
            vs_peer_average DOUBLE DEFAULT 0,
            vs_school_average DOUBLE DEFAULT 0,
            improvement_trend STRING,
            avg_group_completion_rate DOUBLE DEFAULT 0,
            total_leader_ready_events INT DEFAULT 0,
            avg_group_readiness_time DOUBLE DEFAULT 0,
            data_points_included INT DEFAULT 0,
            confidence_score DOUBLE DEFAULT 1.0,
            calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
            PRIMARY KEY(id)
          ) USING DELTA
          PARTITIONED BY (school_id, summary_date)
        `
      },
      {
        name: 'dashboard_metrics_hourly',
        sql: `
          CREATE TABLE IF NOT EXISTS dashboard_metrics_hourly (
            id STRING NOT NULL,
            school_id STRING NOT NULL,
            metric_hour TIMESTAMP NOT NULL,
            sessions_active INT DEFAULT 0,
            sessions_completed INT DEFAULT 0,
            teachers_active INT DEFAULT 0,
            students_active INT DEFAULT 0,
            avg_session_quality DOUBLE DEFAULT 0,
            avg_engagement_score DOUBLE DEFAULT 0,
            avg_participation_rate DOUBLE DEFAULT 0,
            avg_collaboration_score DOUBLE DEFAULT 0,
            avg_audio_quality DOUBLE DEFAULT 0,
            avg_connection_stability DOUBLE DEFAULT 0,
            total_errors INT DEFAULT 0,
            avg_response_time DOUBLE DEFAULT 0,
            total_prompts_generated INT DEFAULT 0,
            total_prompts_used INT DEFAULT 0,
            total_interventions INT DEFAULT 0,
            total_alerts INT DEFAULT 0,
            ai_analyses_completed INT DEFAULT 0,
            avg_ai_processing_time DOUBLE DEFAULT 0,
            ai_analysis_success_rate DOUBLE DEFAULT 0,
            total_transcription_minutes DOUBLE DEFAULT 0,
            total_storage_gb DOUBLE DEFAULT 0,
            estimated_compute_cost DOUBLE DEFAULT 0,
            data_sources_count INT DEFAULT 0,
            calculation_method STRING DEFAULT 'hourly_rollup',
            calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
            PRIMARY KEY(id)
          ) USING DELTA
          PARTITIONED BY (school_id, date(metric_hour))
        `
      },
      {
        name: 'session_analytics_cache',
        sql: `
          CREATE TABLE IF NOT EXISTS session_analytics_cache (
            id STRING NOT NULL,
            session_id STRING NOT NULL,
            teacher_id STRING NOT NULL,
            school_id STRING NOT NULL,
            session_date DATE NOT NULL,
            session_status STRING,
            session_overall_score DOUBLE DEFAULT 0,
            session_effectiveness_score DOUBLE DEFAULT 0,
            session_duration_minutes INT DEFAULT 0,
            total_participants INT DEFAULT 0,
            planned_groups INT DEFAULT 0,
            actual_groups INT DEFAULT 0,
            group_completion_rate DOUBLE DEFAULT 0,
            participation_rate DOUBLE DEFAULT 0,
            avg_engagement_score DOUBLE DEFAULT 0,
            leader_readiness_rate DOUBLE DEFAULT 0,
            avg_readiness_time_minutes DOUBLE DEFAULT 0,
            groups_ready_at_start INT DEFAULT 0,
            groups_ready_at_5min INT DEFAULT 0,
            groups_ready_at_10min INT DEFAULT 0,
            avg_group_score DOUBLE DEFAULT 0,
            avg_critical_thinking_score DOUBLE DEFAULT 0,
            avg_participation_balance DOUBLE DEFAULT 0,
            total_ai_analyses INT DEFAULT 0,
            avg_ai_confidence DOUBLE DEFAULT 0,
            key_insights STRING,
            intervention_recommendations STRING,
            leader_ready_events STRING,
            intervention_events STRING,
            avg_audio_quality DOUBLE DEFAULT 0,
            avg_connection_stability DOUBLE DEFAULT 0,
            error_count INT DEFAULT 0,
            total_transcription_time DOUBLE DEFAULT 0,
            cache_freshness STRING DEFAULT 'fresh',
            last_real_time_update TIMESTAMP,
            last_full_calculation TIMESTAMP,
            cache_hit_count INT DEFAULT 0,
            fallback_count INT DEFAULT 0,
            cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
            PRIMARY KEY(id)
          ) USING DELTA
          PARTITIONED BY (school_id, session_date)
        `
      }
    ];

    const results: { table: string; status: string; message: string }[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (const table of tables) {
      try {
        logger.debug(`🔄 Creating table: ${table.name}...`);
        await getCompositionRoot().getMonitoringRepository().executeSql(table.sql);
        
        // Verify table exists
        await getCompositionRoot().getMonitoringRepository().describeTable(table.name);
        
        results.push({
          table: table.name,
          status: 'success',
          message: 'Table created and verified successfully'
        });
        successCount++;
        logger.debug(`✅ Table ${table.name} created successfully`);
        
      } catch (error) {
        results.push({
          table: table.name,
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
        errorCount++;
        logger.debug(`❌ Failed to create table ${table.name}: ${error instanceof Error ? error.message : error}`);
      }
    }

    return res.json({
      success: successCount > 0,
      data: {
        message: `Pre-aggregated tables setup completed: ${successCount} successful, ${errorCount} failed`,
        results,
        summary: {
          totalTables: tables.length,
          successCount,
          errorCount,
          setupBy: user.id,
          timestamp: new Date().toISOString()
        }
      }
    });
    
  } catch (error) {
    logger.error('Failed to setup tables:', error);
    return res.status(500).json({
      success: false,
      error: 'SETUP_FAILED',
      message: error instanceof Error ? error.message : 'Failed to setup pre-aggregated tables'
    });
  }
};

/**
 * POST /api/v1/analytics/monitoring/cache-sync
 * 
 * Manually trigger cache synchronization to Databricks
 * Admin access only
 */
export const triggerCacheSync = async (req: Request, res: Response): Promise<Response> => {
  try {
    const authReq = req as AuthRequest;
    const user = authReq.user;
    
    // Verify admin access
    if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
      return res.status(403).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Admin access required'
      });
    }

    const { force } = req.body;
    
    // Import the service dynamically to avoid circular dependencies
    const { realTimeAnalyticsCacheService } = await import('../services/real-time-analytics-cache.service');
    
    logger.debug(`🚀 Admin ${user.id} triggered manual cache sync (force: ${force || false})`);
    
    // Trigger the cache sync
    const result = await realTimeAnalyticsCacheService.triggerManualCacheSync();
    
    // Log the admin action
    analyticsLogger.logOperation(
      'admin_cache_sync_triggered',
      'cache_sync',
      Date.now(),
      result.success,
      {
        teacherId: user.id,
        recordCount: result.sessionsProcessed,
        metadata: {
          adminId: user.id,
          force: force || false,
          sessionsProcessed: result.sessionsProcessed,
          sessionsSynced: result.sessionsSynced,
          failedSessions: result.failedSessions,
          duration: result.duration
        },
        forceLog: true
      }
    );
    
    return res.json({
      success: true,
      data: {
        message: 'Cache sync triggered successfully',
        result,
        triggeredBy: user.id,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.error('Failed to trigger cache sync:', error);
    
    // Log the failed admin action
    try {
      const authReq = req as AuthRequest;
      analyticsLogger.logOperation(
        'admin_cache_sync_failed',
        'cache_sync',
        Date.now(),
        false,
        {
          teacherId: authReq.user?.id,
          recordCount: 0,
          error: error instanceof Error ? error.message : String(error),
          metadata: {
            adminId: authReq.user?.id,
            errorType: error instanceof Error ? error.constructor.name : typeof error
          },
          forceLog: true
        }
      );
    } catch (logError) {
      logger.error('Failed to log cache sync failure:', logError);
    }
    
    return res.status(500).json({
      success: false,
      error: 'SYNC_FAILED',
      message: error instanceof Error ? error.message : 'Failed to trigger cache sync'
    });
  }
};
import { getCompositionRoot } from '../app/composition-root';
import { logger } from '../utils/logger';

/**
 * Query Cost Monitor Service
 * 
 * Monitors Databricks query performance and cost metrics to validate
 * the effectiveness of pre-aggregation strategies and identify optimization opportunities.
 */

import { analyticsLogger } from '../utils/analytics-logger';

interface QueryMetrics {
  queryId: string;
  queryName: string;
  executionTime: number; // milliseconds
  dataScannedGB: number;
  estimatedCost: number; // USD
  timestamp: Date;
  queryType: 'analytics' | 'real-time' | 'dashboard' | 'admin';
  cacheHit: boolean;
  optimizationUsed: string; // 'pre-aggregation' | 'redis-cache' | 'none'
}

interface CostAnalysis {
  timeframe: string;
  totalQueries: number;
  totalDataScannedGB: number;
  totalEstimatedCost: number;
  averageQueryTime: number;
  cacheHitRate: number;
  topExpensiveQueries: QueryMetrics[];
  costTrends: {
    daily: number[];
    hourly: number[];
  };
  optimizationImpact: {
    preAggregationSavings: number;
    cacheHitSavings: number;
    totalSavingsPercent: number;
  };
}

export class QueryCostMonitorService {
  private queryMetrics: QueryMetrics[] = [];
  private readonly MAX_STORED_METRICS = 50000; // Keep last 50k queries
  private readonly DATABRICKS_COST_PER_GB = 0.03; // Current Databricks pricing

  /**
   * Record a query execution with performance and cost metrics
   */
  recordQuery(metrics: Omit<QueryMetrics, 'estimatedCost' | 'timestamp'>): void {
    const queryMetric: QueryMetrics = {
      ...metrics,
      estimatedCost: metrics.dataScannedGB * this.DATABRICKS_COST_PER_GB,
      timestamp: new Date()
    };

    // Add to metrics array with rotation
    this.queryMetrics.push(queryMetric);
    if (this.queryMetrics.length > this.MAX_STORED_METRICS) {
      this.queryMetrics.shift(); // Remove oldest entry
    }

    // Log to analytics logger for observability
    analyticsLogger.logOperation(
      'query_cost_tracked',
      'query_monitoring',
      Date.now() - metrics.executionTime,
      true,
      {
        metadata: {
          queryName: metrics.queryName,
          executionTime: metrics.executionTime,
          dataScannedGB: metrics.dataScannedGB,
          estimatedCost: queryMetric.estimatedCost,
          queryType: metrics.queryType,
          cacheHit: metrics.cacheHit,
          optimizationUsed: metrics.optimizationUsed
        },
        sampleRate: 0.1, // Sample 10% of query cost records
      }
    );

    // Log expensive queries immediately
    if (queryMetric.estimatedCost > 1.0 || metrics.executionTime > 5000) {
      console.warn('💰 Expensive query detected:', {
        queryName: metrics.queryName,
        cost: `$${queryMetric.estimatedCost.toFixed(3)}`,
        executionTime: `${metrics.executionTime}ms`,
        dataScanned: `${metrics.dataScannedGB.toFixed(2)}GB`,
        optimization: metrics.optimizationUsed
      });
    }
  }

  /**
   * Get cost analysis for a specific timeframe
   */
  getCostAnalysis(timeframeHours: number = 24): CostAnalysis {
    const cutoffTime = new Date(Date.now() - timeframeHours * 60 * 60 * 1000);
    const recentQueries = this.queryMetrics.filter(q => q.timestamp >= cutoffTime);

    if (recentQueries.length === 0) {
      return this.getEmptyAnalysis(timeframeHours);
    }

    // Basic aggregations
    const totalQueries = recentQueries.length;
    const totalDataScannedGB = recentQueries.reduce((sum, q) => sum + q.dataScannedGB, 0);
    const totalEstimatedCost = recentQueries.reduce((sum, q) => sum + q.estimatedCost, 0);
    const averageQueryTime = recentQueries.reduce((sum, q) => sum + q.executionTime, 0) / totalQueries;
    const cacheHits = recentQueries.filter(q => q.cacheHit).length;
    const cacheHitRate = cacheHits / totalQueries;

    // Top expensive queries
    const topExpensiveQueries = recentQueries
      .sort((a, b) => b.estimatedCost - a.estimatedCost)
      .slice(0, 10);

    // Cost trends (hourly buckets)
    const hourlyBuckets = this.createHourlyBuckets(recentQueries, timeframeHours);
    const dailyBuckets = this.createDailyBuckets(recentQueries, timeframeHours);

    // Optimization impact analysis
    const optimizationImpact = this.calculateOptimizationImpact(recentQueries);

    return {
      timeframe: `${timeframeHours} hours`,
      totalQueries,
      totalDataScannedGB,
      totalEstimatedCost,
      averageQueryTime,
      cacheHitRate,
      topExpensiveQueries,
      costTrends: {
        daily: dailyBuckets,
        hourly: hourlyBuckets
      },
      optimizationImpact
    };
  }

  /**
   * Get cost projections and savings estimates
   */
  getOptimizationReport(): {
    currentPerformance: {
      avgQueryTime: number;
      avgCostPerQuery: number;
      dailyQueryVolume: number;
      projectedMonthlyCost: number;
    };
    potentialSavings: {
      preAggregationOpportunities: string[];
      cacheOptimizationOpportunities: string[];
      estimatedMonthlySavings: number;
      implementationPriority: Array<{
        optimization: string;
        impact: 'high' | 'medium' | 'low';
        effort: 'low' | 'medium' | 'high';
        estimatedSavings: number;
      }>;
    };
  } {
    const last24h = this.getCostAnalysis(24);
    const last7d = this.getCostAnalysis(168); // 7 days

    // Current performance baseline
    const avgQueryTime = last24h.averageQueryTime;
    const avgCostPerQuery = last24h.totalEstimatedCost / last24h.totalQueries;
    const dailyQueryVolume = last24h.totalQueries;
    const projectedMonthlyCost = avgCostPerQuery * dailyQueryVolume * 30;

    // Identify optimization opportunities
    const expensiveQueries = last7d.topExpensiveQueries;
    const slowQueries = this.queryMetrics
      .filter(q => q.executionTime > 3000 && !q.cacheHit)
      .slice(0, 5);

    const preAggregationOpportunities = [
      ...new Set(expensiveQueries
        .filter(q => q.queryType === 'analytics' && !q.optimizationUsed.includes('pre-aggregation'))
        .map(q => q.queryName))
    ];

    const cacheOptimizationOpportunities = [
      ...new Set(slowQueries
        .filter(q => q.queryType === 'real-time' && !q.cacheHit)
        .map(q => q.queryName))
    ];

    // Estimate savings potential
    const preAggregationSavings = expensiveQueries
      .filter(q => preAggregationOpportunities.includes(q.queryName))
      .reduce((sum, q) => sum + q.estimatedCost * 0.75, 0) * 30; // 75% cost reduction

    const cacheSavings = slowQueries
      .filter(q => cacheOptimizationOpportunities.includes(q.queryName))
      .reduce((sum, q) => sum + q.estimatedCost * 0.90, 0) * 30; // 90% cost reduction for cached queries

    const estimatedMonthlySavings = preAggregationSavings + cacheSavings;

    return {
      currentPerformance: {
        avgQueryTime,
        avgCostPerQuery,
        dailyQueryVolume,
        projectedMonthlyCost
      },
      potentialSavings: {
        preAggregationOpportunities,
        cacheOptimizationOpportunities,
        estimatedMonthlySavings,
        implementationPriority: [
          {
            optimization: 'Real-time session metrics caching',
            impact: 'high' as const,
            effort: 'low' as const,
            estimatedSavings: cacheSavings * 0.6 // 60% of cache savings from session metrics
          },
          {
            optimization: 'Teacher analytics pre-aggregation',
            impact: 'high' as const,
            effort: 'medium' as const,
            estimatedSavings: preAggregationSavings * 0.4 // 40% of pre-agg savings from teacher analytics
          },
          {
            optimization: 'Dashboard metrics hourly summaries',
            impact: 'medium' as const,
            effort: 'medium' as const,
            estimatedSavings: preAggregationSavings * 0.3
          },
          {
            optimization: 'School comparison metrics weekly batch',
            impact: 'low' as const,
            effort: 'high' as const,
            estimatedSavings: preAggregationSavings * 0.2
          }
        ].sort((a, b) => {
          // Sort by impact/effort ratio
          const scoreA = (a.impact === 'high' ? 3 : a.impact === 'medium' ? 2 : 1) / 
                         (a.effort === 'low' ? 1 : a.effort === 'medium' ? 2 : 3);
          const scoreB = (b.impact === 'high' ? 3 : b.impact === 'medium' ? 2 : 1) / 
                         (b.effort === 'low' ? 1 : b.effort === 'medium' ? 2 : 3);
          return scoreB - scoreA;
        })
      }
    };
  }

  /**
   * Generate automated cost alerts and recommendations
   */
  checkCostAlerts(): Array<{
    type: 'cost_spike' | 'slow_query' | 'optimization_opportunity';
    severity: 'high' | 'medium' | 'low';
    message: string;
    action: string;
    queryName?: string;
    cost?: number;
  }> {
    const alerts: Array<{
      type: 'cost_spike' | 'slow_query' | 'optimization_opportunity';
      severity: 'high' | 'medium' | 'low';
      message: string;
      action: string;
      queryName?: string;
      cost?: number;
    }> = [];

    const last1h = this.getCostAnalysis(1);
    const last24h = this.getCostAnalysis(24);

    // Check for cost spikes
    const hourlyAvgCost = last24h.totalEstimatedCost / 24;
    if (last1h.totalEstimatedCost > hourlyAvgCost * 3) {
      alerts.push({
        type: 'cost_spike',
        severity: 'high',
        message: `Query costs in the last hour (${last1h.totalEstimatedCost.toFixed(2)}) are 3x higher than 24h average (${hourlyAvgCost.toFixed(2)})`,
        action: 'Investigate recent query patterns and consider scaling down non-critical analytics'
      });
    }

    // Check for slow queries
    const slowQueries = this.queryMetrics
      .filter(q => q.timestamp >= new Date(Date.now() - 60 * 60 * 1000) && q.executionTime > 10000)
      .slice(0, 3);

    slowQueries.forEach(query => {
      alerts.push({
        type: 'slow_query',
        severity: 'medium',
        message: `Query ${query.queryName} took ${query.executionTime}ms to execute`,
        action: 'Consider adding pre-aggregation or caching for this query pattern',
        queryName: query.queryName
      });
    });

    // Check for optimization opportunities
    const expensiveNonOptimized = this.queryMetrics
      .filter(q => 
        q.timestamp >= new Date(Date.now() - 24 * 60 * 60 * 1000) &&
        q.estimatedCost > 0.5 &&
        q.optimizationUsed === 'none'
      )
      .slice(0, 2);

    expensiveNonOptimized.forEach(query => {
      alerts.push({
        type: 'optimization_opportunity',
        severity: 'low',
        message: `Expensive query ${query.queryName} could benefit from optimization`,
        action: 'Consider implementing pre-aggregation or caching strategy',
        queryName: query.queryName,
        cost: query.estimatedCost
      });
    });

    return alerts;
  }

  // Private helper methods

  private getEmptyAnalysis(timeframeHours: number): CostAnalysis {
    return {
      timeframe: `${timeframeHours} hours`,
      totalQueries: 0,
      totalDataScannedGB: 0,
      totalEstimatedCost: 0,
      averageQueryTime: 0,
      cacheHitRate: 0,
      topExpensiveQueries: [],
      costTrends: { daily: [], hourly: [] },
      optimizationImpact: {
        preAggregationSavings: 0,
        cacheHitSavings: 0,
        totalSavingsPercent: 0
      }
    };
  }

  private createHourlyBuckets(queries: QueryMetrics[], timeframeHours: number): number[] {
    const buckets = new Array(Math.min(timeframeHours, 24)).fill(0);
    const now = new Date();

    queries.forEach(query => {
      const hoursAgo = Math.floor((now.getTime() - query.timestamp.getTime()) / (60 * 60 * 1000));
      if (hoursAgo < buckets.length) {
        buckets[buckets.length - 1 - hoursAgo] += query.estimatedCost;
      }
    });

    return buckets;
  }

  private createDailyBuckets(queries: QueryMetrics[], timeframeHours: number): number[] {
    const days = Math.ceil(timeframeHours / 24);
    const buckets = new Array(days).fill(0);
    const now = new Date();

    queries.forEach(query => {
      const daysAgo = Math.floor((now.getTime() - query.timestamp.getTime()) / (24 * 60 * 60 * 1000));
      if (daysAgo < buckets.length) {
        buckets[buckets.length - 1 - daysAgo] += query.estimatedCost;
      }
    });

    return buckets;
  }

  private calculateOptimizationImpact(queries: QueryMetrics[]): {
    preAggregationSavings: number;
    cacheHitSavings: number;
    totalSavingsPercent: number;
  } {
    const totalCost = queries.reduce((sum, q) => sum + q.estimatedCost, 0);
    const preAggQueries = queries.filter(q => q.optimizationUsed.includes('pre-aggregation'));
    const cacheHitQueries = queries.filter(q => q.cacheHit);

    // Estimate what these queries would have cost without optimization
    const preAggregationSavings = preAggQueries.reduce((sum, q) => sum + q.estimatedCost * 3, 0); // Assume 3x cost without pre-agg
    const cacheHitSavings = cacheHitQueries.reduce((sum, q) => sum + q.estimatedCost * 9, 0); // Assume 10x cost without cache

    const totalSavings = preAggregationSavings + cacheHitSavings;
    const totalSavingsPercent = totalCost > 0 ? (totalSavings / (totalCost + totalSavings)) * 100 : 0;

    return {
      preAggregationSavings,
      cacheHitSavings,
      totalSavingsPercent
    };
  }
}

// Export singleton instance
export const queryCostMonitorService = new QueryCostMonitorService();

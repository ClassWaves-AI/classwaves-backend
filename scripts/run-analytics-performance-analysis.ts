#!/usr/bin/env node

/**
 * Analytics Performance Analysis Script
 * 
 * Runs a comprehensive analysis of analytics query performance,
 * identifies optimization opportunities, and generates implementation recommendations.
 */

import { analyticsPerformanceAnalyzer } from '../src/analysis/analytics-performance-analysis';
import { queryCostMonitorService } from '../src/services/query-cost-monitor.service';

async function runAnalysis(): Promise<void> {
  console.log('🚀 Starting comprehensive analytics performance analysis...\n');
  
  try {
    // Run full performance analysis
    await analyticsPerformanceAnalyzer.runFullAnalysis();
    
    console.log('\n📊 DETAILED ANALYSIS RESULTS:');
    console.log('=' .repeat(80));
    
    // Get current query patterns
    const currentQueries = await analyticsPerformanceAnalyzer.analyzeCurrentQueries();
    console.log(`\n🔍 CURRENT QUERY ANALYSIS (${currentQueries.length} patterns analyzed):`);
    
    currentQueries.forEach(query => {
      console.log(`\n📈 ${query.queryName}:`);
      console.log(`   • Execution Time: ${query.averageExecutionTime}ms (${query.frequency} frequency)`);
      console.log(`   • Data Scanned: ${query.estimatedDataScanned}`);
      console.log(`   • Cost Impact: ${query.costImpact} (complexity: ${query.complexityScore}/10)`);
      console.log(`   • Recommendation: ${query.recommendedOptimization.substring(0, 100)}...`);
    });
    
    // Get pre-aggregation strategies
    const strategies = await analyticsPerformanceAnalyzer.generatePreAggregationStrategies();
    console.log(`\n🎯 PRE-AGGREGATION STRATEGIES (${strategies.length} recommended):`);
    
    strategies.forEach(strategy => {
      console.log(`\n📋 ${strategy.tableName}:`);
      console.log(`   • Update Frequency: ${strategy.updateFrequency}`);
      console.log(`   • Level: ${strategy.aggregationLevel}`);
      console.log(`   • Query Time Reduction: ${strategy.estimatedSavings.queryTimeReduction}%`);
      console.log(`   • Cost Reduction: ${strategy.estimatedSavings.costReduction}%`);
      console.log(`   • Data Scanning Saved: ${strategy.estimatedSavings.dataScanning}`);
    });
    
    // Get cost impact analysis
    const costImpact = await analyticsPerformanceAnalyzer.calculateCostImpact();
    console.log('\n💰 COST IMPACT ANALYSIS:');
    console.log(`   Current Daily Cost: $${costImpact.currentCosts.estimatedDailyCost}`);
    console.log(`   Current Data Scanned: ${costImpact.currentCosts.avgDataScannedGB}GB/day`);
    console.log(`   Projected Daily Cost: $${costImpact.projectedCosts.estimatedDailyCost + costImpact.projectedCosts.preAggregationCost}`);
    console.log(`   Projected Data Scanned: ${costImpact.projectedCosts.avgDataScannedGB}GB/day`);
    console.log(`   Monthly Savings: $${costImpact.savings.monthlyDollarSavings}`);
    console.log(`   Cost Reduction: ${costImpact.savings.costReductionPercent}%`);
    console.log(`   Performance Improvement: ${costImpact.savings.performanceImprovement}`);
    
    // Get implementation plan
    const implementationPlan = await analyticsPerformanceAnalyzer.generateImplementationPlan();
    console.log('\n📋 IMPLEMENTATION PLAN:');
    console.log(`Timeline: ${implementationPlan.rolloutTimeline}\n`);
    
    console.log('🥇 PHASE 1 (Highest Impact, Lowest Risk):');
    implementationPlan.phase1.forEach(task => console.log(`   • ${task}`));
    
    console.log('\n🥈 PHASE 2 (Medium Impact, Medium Risk):');
    implementationPlan.phase2.forEach(task => console.log(`   • ${task}`));
    
    console.log('\n🥉 PHASE 3 (Lower Impact, Higher Risk):');
    implementationPlan.phase3.forEach(task => console.log(`   • ${task}`));
    
    console.log('\n⚠️  RISK MITIGATION:');
    implementationPlan.riskMitigation.forEach(risk => console.log(`   • ${risk}`));
    
    // Get current cost monitoring data (if available)
    const optimizationReport = queryCostMonitorService.getOptimizationReport();
    console.log('\n📈 OPTIMIZATION OPPORTUNITIES:');
    console.log(`   Current Avg Query Time: ${optimizationReport.currentPerformance.avgQueryTime.toFixed(0)}ms`);
    console.log(`   Current Avg Cost Per Query: $${optimizationReport.currentPerformance.avgCostPerQuery.toFixed(4)}`);
    console.log(`   Daily Query Volume: ${optimizationReport.currentPerformance.dailyQueryVolume}`);
    console.log(`   Projected Monthly Cost: $${optimizationReport.currentPerformance.projectedMonthlyCost.toFixed(2)}`);
    
    if (optimizationReport.potentialSavings.preAggregationOpportunities.length > 0) {
      console.log('\n🎯 PRE-AGGREGATION OPPORTUNITIES:');
      optimizationReport.potentialSavings.preAggregationOpportunities.forEach(opp => 
        console.log(`   • ${opp}`)
      );
    }
    
    if (optimizationReport.potentialSavings.cacheOptimizationOpportunities.length > 0) {
      console.log('\n⚡ CACHE OPTIMIZATION OPPORTUNITIES:');
      optimizationReport.potentialSavings.cacheOptimizationOpportunities.forEach(opp => 
        console.log(`   • ${opp}`)
      );
    }
    
    console.log('\n🏆 IMPLEMENTATION PRIORITY (Impact/Effort Ratio):');
    optimizationReport.potentialSavings.implementationPriority.forEach((item, index) => {
      console.log(`   ${index + 1}. ${item.optimization}`);
      console.log(`      Impact: ${item.impact} | Effort: ${item.effort} | Savings: $${item.estimatedSavings.toFixed(2)}/month`);
    });
    
    // Check for cost alerts
    const costAlerts = queryCostMonitorService.checkCostAlerts();
    if (costAlerts.length > 0) {
      console.log('\n🚨 COST ALERTS:');
      costAlerts.forEach(alert => {
        const emoji = alert.severity === 'high' ? '🔴' : alert.severity === 'medium' ? '🟡' : '🟢';
        console.log(`   ${emoji} ${alert.type.toUpperCase()}: ${alert.message}`);
        console.log(`      Action: ${alert.action}`);
        if (alert.queryName) console.log(`      Query: ${alert.queryName}`);
        if (alert.cost) console.log(`      Cost: $${alert.cost.toFixed(3)}`);
      });
    }
    
    console.log('\n' + '=' .repeat(80));
    console.log('✅ ANALYSIS COMPLETE');
    console.log('=' .repeat(80));
    
    console.log('\n🎯 KEY RECOMMENDATIONS:');
    console.log('1. Start with Phase 1 implementations (Redis cache for real-time metrics)');
    console.log('2. Focus on high-frequency, expensive queries first');
    console.log(`3. Target ${costImpact.savings.costReductionPercent}% cost reduction over 6-8 weeks`);
    console.log('4. Monitor query cost alerts daily during rollout');
    console.log('5. Validate pre-aggregation data consistency with source tables');
    
    console.log('\n📊 NEXT STEPS:');
    console.log('1. Review implementation plan with team');
    console.log('2. Set up monitoring dashboard for query costs');
    console.log('3. Begin Phase 1 implementation (real-time caching)');
    console.log('4. Establish performance baselines before changes');
    console.log('5. Plan gradual rollout with feature flags');
    
  } catch (error) {
    console.error('❌ Analysis failed:', error);
    process.exit(1);
  }
}

// Run the analysis
if (require.main === module) {
  runAnalysis()
    .then(() => {
      console.log('\n🎉 Analytics performance analysis completed successfully!');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Failed to complete analysis:', error);
      process.exit(1);
    });
}

#!/usr/bin/env tsx

/**
 * ClassWaves Data Integrity Audit Script
 * 
 * This script scans the classroom_sessions and student_groups tables 
 * for data inconsistencies and reports findings.
 * 
 * USAGE:
 *   npm run db:integrity-audit
 * 
 * REQUIREMENTS:
 *   - Valid Databricks connection (DATABRICKS_TOKEN in .env)
 *   - Access to the classwaves Unity Catalog
 *   - Read permissions on sessions and users schemas
 * 
 * WHEN TO RUN:
 *   - Before production deployments
 *   - After major data migrations
 *   - During regular maintenance windows
 *   - When investigating data quality issues
 *   - Monthly or quarterly for preventive maintenance
 * 
 * OUTPUT:
 *   - Console report with prioritized issues
 *   - Detailed JSON report saved to test-results/
 *   - Specific recommendations for each issue type
 * 
 * CHECKS PERFORMED:
 * 1. Sessions stuck in 'active' state for > 6 hours
 * 2. Orphaned student groups (invalid session_id references)
 * 3. Orphaned group members (invalid group_id references)
 * 4. Group size inconsistencies (current_size vs actual member count)
 * 5. Leader inconsistencies (leader_id not in group members)
 * 6. Orphaned participants (invalid session_id or group_id references)
 * 7. Sessions with end time before start time
 * 8. Groups with timestamps outside session duration
 * 
 * PHASE 1 STABILIZATION: Task 1.3 [P2]
 */

import { DatabricksService } from '../services/databricks.service';
import { databricksConfig } from '../config/databricks.config';
import { logger } from '../utils/logger';

interface AuditResult {
  category: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  count: number;
  description: string;
  sampleData?: any[];
  suggestedAction: string;
}

class DataIntegrityAuditor {
  private databricksService: DatabricksService;

  constructor() {
    this.databricksService = new DatabricksService();
  }

  async runFullAudit(): Promise<AuditResult[]> {
    logger.debug('🔍 Starting ClassWaves Data Integrity Audit...\n');
    
    const results: AuditResult[] = [];

    // Test database connection before running audit
    try {
      logger.debug('🔗 Testing database connection...');
      await this.databricksService.query('SELECT 1 as test_connection LIMIT 1');
      logger.debug('✅ Database connection successful\n');
    } catch (connectionError) {
      logger.error('❌ Database connection failed:', connectionError);
      logger.debug('\n🔧 TROUBLESHOOTING:\n');
      logger.debug('   1. Ensure DATABRICKS_TOKEN is set in your .env file');
      logger.debug('   2. Verify DATABRICKS_HOST and DATABRICKS_WAREHOUSE_ID are correct');
      logger.debug('   3. Check that your Databricks token has not expired');
      logger.debug('   4. Ensure the Unity Catalog "classwaves" exists and is accessible\n');
      logger.debug('💡 This script requires a live Databricks connection to scan for data integrity issues.');
      process.exit(1);
    }

    try {
      // 1. Check for sessions stuck in 'active' state
      results.push(await this.auditStuckActiveSessions());
      
      // 2. Check for orphaned student groups
      results.push(await this.auditOrphanedGroups());
      
      // 3. Check for orphaned group members
      results.push(await this.auditOrphanedGroupMembers());
      
      // 4. Check for group size inconsistencies
      results.push(await this.auditGroupSizeInconsistencies());
      
      // 5. Check for leader inconsistencies
      results.push(await this.auditLeaderInconsistencies());
      
      // 6. Check for orphaned participants
      results.push(await this.auditOrphanedParticipants());
      
      // 7. Check for invalid session time ranges
      results.push(await this.auditInvalidSessionTimes());
      
      // 8. Check for groups with timestamps outside session duration
      results.push(await this.auditGroupTimestampConsistency());

      await this.generateReport(results);
      
    } catch (error) {
      logger.error('❌ Audit failed:', error);
      process.exit(1);
    }

    return results;
  }

  private async auditStuckActiveSessions(): Promise<AuditResult> {
    logger.debug('🔄 Checking for sessions stuck in active state...');
    
    // Sessions active for more than 6 hours are likely stuck
    const sixHoursAgo = new Date();
    sixHoursAgo.setHours(sixHoursAgo.getHours() - 6);
    
    const stuckSessions = await this.databricksService.query(`
      SELECT 
        id, 
        teacher_id, 
        topic, 
        status, 
        actual_start,
        DATEDIFF(HOUR, actual_start, NOW()) as hours_active,
        created_at
      FROM ${databricksConfig.catalog}.sessions.classroom_sessions 
      WHERE status = 'active' 
        AND actual_start IS NOT NULL 
        AND actual_start < ?
      ORDER BY actual_start ASC
      LIMIT 20
    `, [sixHoursAgo.toISOString()]);

    return {
      category: 'Sessions Stuck Active',
      severity: 'HIGH',
      count: stuckSessions.length,
      description: `Sessions that have been in 'active' status for more than 6 hours without being ended`,
      sampleData: stuckSessions.slice(0, 5),
      suggestedAction: 'Review and manually end these sessions if they are no longer active'
    };
  }

  private async auditOrphanedGroups(): Promise<AuditResult> {
    logger.debug('🔗 Checking for orphaned student groups...');
    
    const orphanedGroups = await this.databricksService.query(`
      SELECT 
        sg.id,
        sg.session_id,
        sg.name,
        sg.status,
        sg.created_at
      FROM ${databricksConfig.catalog}.sessions.student_groups sg
      LEFT JOIN ${databricksConfig.catalog}.sessions.classroom_sessions cs 
        ON sg.session_id = cs.id
      WHERE cs.id IS NULL
      ORDER BY sg.created_at DESC
      LIMIT 50
    `);

    return {
      category: 'Orphaned Student Groups',
      severity: 'HIGH',
      count: orphanedGroups.length,
      description: 'Student groups referencing non-existent session IDs',
      sampleData: orphanedGroups.slice(0, 5),
      suggestedAction: 'Delete these orphaned group records or investigate missing sessions'
    };
  }

  private async auditOrphanedGroupMembers(): Promise<AuditResult> {
    logger.debug('👥 Checking for orphaned group members...');
    
    const orphanedMembers = await this.databricksService.query(`
      SELECT 
        sgm.id,
        sgm.session_id,
        sgm.group_id,
        sgm.student_id,
        sgm.created_at,
        CASE 
          WHEN sg.id IS NULL THEN 'missing_group'
          WHEN cs.id IS NULL THEN 'missing_session'
          WHEN sgm.session_id != sg.session_id THEN 'session_mismatch'
          ELSE 'unknown'
        END as issue_type
      FROM ${databricksConfig.catalog}.sessions.student_group_members sgm
      LEFT JOIN ${databricksConfig.catalog}.sessions.student_groups sg 
        ON sgm.group_id = sg.id
      LEFT JOIN ${databricksConfig.catalog}.sessions.classroom_sessions cs 
        ON sgm.session_id = cs.id
      WHERE sg.id IS NULL 
         OR cs.id IS NULL 
         OR sgm.session_id != sg.session_id
      ORDER BY sgm.created_at DESC
      LIMIT 50
    `);

    return {
      category: 'Orphaned Group Members',
      severity: 'HIGH',
      count: orphanedMembers.length,
      description: 'Group member records with invalid group_id or session_id references',
      sampleData: orphanedMembers.slice(0, 5),
      suggestedAction: 'Clean up these orphaned member records'
    };
  }

  private async auditGroupSizeInconsistencies(): Promise<AuditResult> {
    logger.debug('📊 Checking for group size inconsistencies...');
    
    const sizeInconsistencies = await this.databricksService.query(`
      SELECT 
        sg.id,
        sg.session_id,
        sg.name,
        sg.current_size as recorded_size,
        COUNT(sgm.student_id) as actual_size,
        ABS(sg.current_size - COUNT(sgm.student_id)) as size_difference
      FROM ${databricksConfig.catalog}.sessions.student_groups sg
      LEFT JOIN ${databricksConfig.catalog}.sessions.student_group_members sgm 
        ON sg.id = sgm.group_id
      GROUP BY sg.id, sg.session_id, sg.name, sg.current_size
      HAVING sg.current_size != COUNT(sgm.student_id)
      ORDER BY size_difference DESC
      LIMIT 50
    `);

    return {
      category: 'Group Size Inconsistencies',
      severity: 'MEDIUM',
      count: sizeInconsistencies.length,
      description: 'Groups where recorded current_size does not match actual member count',
      sampleData: sizeInconsistencies.slice(0, 5),
      suggestedAction: 'Update current_size to match actual member counts'
    };
  }

  private async auditLeaderInconsistencies(): Promise<AuditResult> {
    logger.debug('👑 Checking for leader inconsistencies...');
    
    const leaderInconsistencies = await this.databricksService.query(`
      SELECT 
        sg.id as group_id,
        sg.session_id,
        sg.name as group_name,
        sg.leader_id,
        CASE 
          WHEN sgm.student_id IS NULL THEN 'leader_not_member'
          ELSE 'ok'
        END as issue_type
      FROM ${databricksConfig.catalog}.sessions.student_groups sg
      LEFT JOIN ${databricksConfig.catalog}.sessions.student_group_members sgm 
        ON sg.id = sgm.group_id AND sg.leader_id = sgm.student_id
      WHERE sg.leader_id IS NOT NULL 
        AND sgm.student_id IS NULL
      ORDER BY sg.created_at DESC
      LIMIT 50
    `);

    return {
      category: 'Leader Inconsistencies',
      severity: 'MEDIUM',
      count: leaderInconsistencies.length,
      description: 'Groups with leader_id not found in group members',
      sampleData: leaderInconsistencies.slice(0, 5),
      suggestedAction: 'Either add leaders to group members or clear leader_id field'
    };
  }

  private async auditOrphanedParticipants(): Promise<AuditResult> {
    logger.debug('🎭 Checking for orphaned participants...');
    
    const orphanedParticipants = await this.databricksService.query(`
      SELECT 
        p.id,
        p.session_id,
        p.group_id,
        p.display_name,
        p.join_time,
        CASE 
          WHEN cs.id IS NULL THEN 'missing_session'
          WHEN p.group_id IS NOT NULL AND sg.id IS NULL THEN 'missing_group'
          ELSE 'unknown'
        END as issue_type
      FROM ${databricksConfig.catalog}.sessions.participants p
      LEFT JOIN ${databricksConfig.catalog}.sessions.classroom_sessions cs 
        ON p.session_id = cs.id
      LEFT JOIN ${databricksConfig.catalog}.sessions.student_groups sg 
        ON p.group_id = sg.id
      WHERE cs.id IS NULL 
         OR (p.group_id IS NOT NULL AND sg.id IS NULL)
      ORDER BY p.join_time DESC
      LIMIT 50
    `);

    return {
      category: 'Orphaned Participants',
      severity: 'MEDIUM',
      count: orphanedParticipants.length,
      description: 'Participant records with invalid session_id or group_id references',
      sampleData: orphanedParticipants.slice(0, 5),
      suggestedAction: 'Clean up these orphaned participant records'
    };
  }

  private async auditInvalidSessionTimes(): Promise<AuditResult> {
    logger.debug('⏰ Checking for invalid session time ranges...');
    
    const invalidTimes = await this.databricksService.query(`
      SELECT 
        id,
        teacher_id,
        topic,
        status,
        actual_start,
        actual_end,
        actual_duration_minutes,
        CASE 
          WHEN actual_end < actual_start THEN 'end_before_start'
          WHEN actual_duration_minutes < 0 THEN 'negative_duration'
          WHEN actual_duration_minutes > 480 THEN 'excessive_duration'
          ELSE 'unknown'
        END as issue_type
      FROM ${databricksConfig.catalog}.sessions.classroom_sessions 
      WHERE (actual_end IS NOT NULL AND actual_start IS NOT NULL AND actual_end < actual_start)
         OR actual_duration_minutes < 0
         OR actual_duration_minutes > 480
      ORDER BY created_at DESC
      LIMIT 20
    `);

    return {
      category: 'Invalid Session Times',
      severity: 'HIGH',
      count: invalidTimes.length,
      description: 'Sessions with end time before start time or invalid durations',
      sampleData: invalidTimes.slice(0, 5),
      suggestedAction: 'Review and fix these session time inconsistencies'
    };
  }

  private async auditGroupTimestampConsistency(): Promise<AuditResult> {
    logger.debug('🕐 Checking group timestamp consistency with sessions...');
    
    const timestampInconsistencies = await this.databricksService.query(`
      SELECT 
        sg.id as group_id,
        sg.session_id,
        sg.name as group_name,
        sg.start_time as group_start,
        sg.end_time as group_end,
        cs.actual_start as session_start,
        cs.actual_end as session_end,
        CASE 
          WHEN sg.start_time < cs.actual_start THEN 'group_started_early'
          WHEN sg.end_time > cs.actual_end THEN 'group_ended_late'
          WHEN sg.start_time > cs.actual_end THEN 'group_started_after_session'
          ELSE 'unknown'
        END as issue_type
      FROM ${databricksConfig.catalog}.sessions.student_groups sg
      INNER JOIN ${databricksConfig.catalog}.sessions.classroom_sessions cs 
        ON sg.session_id = cs.id
      WHERE cs.actual_start IS NOT NULL 
        AND cs.actual_end IS NOT NULL
        AND (sg.start_time < cs.actual_start 
             OR sg.end_time > cs.actual_end 
             OR sg.start_time > cs.actual_end)
      ORDER BY sg.created_at DESC
      LIMIT 30
    `);

    return {
      category: 'Group Timestamp Inconsistencies',
      severity: 'LOW',
      count: timestampInconsistencies.length,
      description: 'Groups with start/end times outside their session duration',
      sampleData: timestampInconsistencies.slice(0, 5),
      suggestedAction: 'Review and align group timestamps with session boundaries'
    };
  }

  private async generateReport(results: AuditResult[]): Promise<void> {
    logger.debug('\n' + '='.repeat(80));
    logger.debug('📋 CLASSW AVES DATA INTEGRITY AUDIT REPORT');
    logger.debug('='.repeat(80) + '\n');

    const highSeverity = results.filter(r => r.severity === 'HIGH');
    const mediumSeverity = results.filter(r => r.severity === 'MEDIUM');
    const lowSeverity = results.filter(r => r.severity === 'LOW');

    logger.debug('🚨 HIGH PRIORITY ISSUES:');
    if (highSeverity.length === 0) {
      logger.debug('   ✅ No high priority issues found\n');
    } else {
      highSeverity.forEach(result => {
        logger.debug(`   ❌ ${result.category}: ${result.count} issues`);
        logger.debug(`      ${result.description}`);
        logger.debug(`      Action: ${result.suggestedAction}\n`);
      });
    }

    logger.debug('⚠️  MEDIUM PRIORITY ISSUES:');
    if (mediumSeverity.length === 0) {
      logger.debug('   ✅ No medium priority issues found\n');
    } else {
      mediumSeverity.forEach(result => {
        logger.debug(`   🟡 ${result.category}: ${result.count} issues`);
        logger.debug(`      ${result.description}`);
        logger.debug(`      Action: ${result.suggestedAction}\n`);
      });
    }

    logger.debug('ℹ️  LOW PRIORITY ISSUES:');
    if (lowSeverity.length === 0) {
      logger.debug('   ✅ No low priority issues found\n');
    } else {
      lowSeverity.forEach(result => {
        logger.debug(`   🔵 ${result.category}: ${result.count} issues`);
        logger.debug(`      ${result.description}`);
        logger.debug(`      Action: ${result.suggestedAction}\n`);
      });
    }

    // Summary statistics
    const totalIssues = results.reduce((sum, r) => sum + r.count, 0);
    logger.debug('📊 AUDIT SUMMARY:');
    logger.debug(`   Total Issues Found: ${totalIssues}`);
    logger.debug(`   High Priority: ${highSeverity.reduce((sum, r) => sum + r.count, 0)}`);
    logger.debug(`   Medium Priority: ${mediumSeverity.reduce((sum, r) => sum + r.count, 0)}`);
    logger.debug(`   Low Priority: ${lowSeverity.reduce((sum, r) => sum + r.count, 0)}`);

    // Save detailed report to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportData = {
      auditTimestamp: new Date().toISOString(),
      totalIssuesFound: totalIssues,
      results: results,
      summary: {
        highPriority: highSeverity.length,
        mediumPriority: mediumSeverity.length,
        lowPriority: lowSeverity.length
      }
    };

    const fs = await import('fs');
    const path = await import('path');
    const reportPath = path.join(__dirname, '../../test-results', `data-integrity-audit-${timestamp}.json`);
    
    // Ensure directory exists
    const dir = path.dirname(reportPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
    logger.debug(`\n📄 Detailed report saved to: ${reportPath}`);

    if (totalIssues > 0) {
      logger.debug('\n🎯 RECOMMENDED NEXT STEPS:');
      logger.debug('   1. Address HIGH priority issues immediately');
      logger.debug('   2. Schedule cleanup for MEDIUM priority issues');
      logger.debug('   3. Review LOW priority issues during regular maintenance');
      logger.debug('   4. Run this audit regularly to prevent data degradation\n');
    } else {
      logger.debug('\n🎉 EXCELLENT! No data integrity issues found. The database is in good health.\n');
    }
  }
}

// Main execution
async function main() {
  const auditor = new DataIntegrityAuditor();
  
  try {
    await auditor.runFullAudit();
    logger.debug('✅ Data integrity audit completed successfully!');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Audit failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { DataIntegrityAuditor, AuditResult };
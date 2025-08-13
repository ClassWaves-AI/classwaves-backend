#!/usr/bin/env ts-node

/**
 * Backfill Script for Legacy Sessions - Planned Fields
 * 
 * This script identifies legacy sessions with NULL planned fields and
 * approximates planning data based on actual group/student counts.
 * 
 * Usage:
 *   npm run script -- scripts/backfill-planned-fields.ts [--dry-run] [--batch-size=100]
 * 
 * Options:
 *   --dry-run        Show what would be updated without making changes
 *   --batch-size     Number of sessions to process per batch (default: 100)
 *   --force          Skip confirmation prompt
 */

import { databricksService } from '../src/services/databricks.service';

interface LegacySession {
  id: string;
  topic: string;
  teacher_id: string;
  school_id: string;
  status: string;
  actual_groups: number;
  actual_members: number;
  actual_leaders: number;
  actual_duration_minutes?: number;
  started_at?: Date;
  ended_at?: Date;
}

interface BackfillStats {
  totalSessions: number;
  legacySessions: number;
  alreadyBackfilled: number;
  toUpdate: number;
  updated: number;
  errors: number;
}

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_PLANNED_DURATION = 45; // minutes

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const batchSizeArg = args.find(arg => arg.startsWith('--batch-size='));
  const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1]) : DEFAULT_BATCH_SIZE;

  console.log('🔍 ClassWaves Legacy Session Backfill Tool');
  console.log('==========================================\n');

  if (isDryRun) {
    console.log('🧪 DRY RUN MODE - No changes will be made\n');
  }

  const stats: BackfillStats = {
    totalSessions: 0,
    legacySessions: 0,
    alreadyBackfilled: 0,
    toUpdate: 0,
    updated: 0,
    errors: 0,
  };

  try {
    // Step 1: Identify all sessions and their current state
    console.log('📊 Analyzing session data...');
    await analyzeSessions(stats);

    // Step 2: Find legacy sessions that need backfilling
    console.log('🔍 Identifying legacy sessions...');
    const legacySessions = await findLegacySessions(batchSize);
    stats.toUpdate = legacySessions.length;

    if (stats.toUpdate === 0) {
      console.log('✅ No legacy sessions found that need backfilling.');
      return;
    }

    // Step 3: Show what will be updated
    console.log(`\n📈 Backfill Summary:`);
    console.log(`   Total Sessions: ${stats.totalSessions}`);
    console.log(`   Legacy Sessions: ${stats.legacySessions}`);
    console.log(`   Already Backfilled: ${stats.alreadyBackfilled}`);
    console.log(`   Sessions to Update: ${stats.toUpdate}`);
    console.log(`   Batch Size: ${batchSize}\n`);

    // Step 4: Show sample of what will be updated
    console.log('🔍 Sample sessions to be updated:');
    legacySessions.slice(0, 5).forEach((session, index) => {
      console.log(`   ${index + 1}. ${session.topic} (${session.id})`);
      console.log(`      Groups: ${session.actual_groups}, Members: ${session.actual_members}, Leaders: ${session.actual_leaders}`);
    });
    if (legacySessions.length > 5) {
      console.log(`   ... and ${legacySessions.length - 5} more sessions\n`);
    }

    // Step 5: Confirmation (unless forced)
    if (!isDryRun && !force) {
      const response = await askForConfirmation();
      if (!response) {
        console.log('❌ Backfill cancelled by user.');
        return;
      }
    }

    // Step 6: Execute backfill
    if (isDryRun) {
      console.log('🧪 DRY RUN: Would update the following sessions:');
      legacySessions.forEach(session => {
        const plannedData = calculatePlannedData(session);
        console.log(`   ${session.id}: ${JSON.stringify(plannedData)}`);
      });
    } else {
      console.log('⚡ Starting backfill process...');
      await executeBackfill(legacySessions, stats, batchSize);
    }

    // Step 7: Final report
    printFinalReport(stats, isDryRun);

  } catch (error) {
    console.error('💥 Backfill failed:', error);
    process.exit(1);
  }
}

async function analyzeSessions(stats: BackfillStats): Promise<void> {
  // Get overall session counts
  const totalQuery = `
    SELECT COUNT(*) as total_sessions
    FROM classwaves.sessions.classroom_sessions
  `;
  const totalResult = await databricksService.queryOne(totalQuery);
  stats.totalSessions = totalResult?.total_sessions || 0;

  // Get legacy session counts (sessions with null planned fields)
  const legacyQuery = `
    SELECT COUNT(*) as legacy_sessions
    FROM classwaves.sessions.classroom_sessions cs
    LEFT JOIN classwaves.analytics.session_metrics sm ON cs.id = sm.session_id
    WHERE sm.planned_groups IS NULL OR sm.planned_members IS NULL OR sm.planned_leaders IS NULL
  `;
  const legacyResult = await databricksService.queryOne(legacyQuery);
  stats.legacySessions = legacyResult?.legacy_sessions || 0;

  stats.alreadyBackfilled = stats.totalSessions - stats.legacySessions;

  console.log(`   Found ${stats.totalSessions} total sessions`);
  console.log(`   Found ${stats.legacySessions} legacy sessions`);
  console.log(`   Found ${stats.alreadyBackfilled} already backfilled sessions`);
}

async function findLegacySessions(limit: number): Promise<LegacySession[]> {
  const query = `
    SELECT 
      cs.id,
      cs.topic,
      cs.teacher_id,
      cs.school_id,
      cs.status,
      COALESCE(actual_groups_count.count, 0) as actual_groups,
      COALESCE(actual_members_count.count, 0) as actual_members,
      COALESCE(actual_leaders_count.count, 0) as actual_leaders,
      sm.actual_duration_minutes,
      cs.started_at,
      cs.ended_at
    FROM classwaves.sessions.classroom_sessions cs
    LEFT JOIN classwaves.analytics.session_metrics sm ON cs.id = sm.session_id
    LEFT JOIN (
      SELECT session_id, COUNT(*) as count
      FROM classwaves.sessions.student_groups
      GROUP BY session_id
    ) actual_groups_count ON cs.id = actual_groups_count.session_id
    LEFT JOIN (
      SELECT session_id, SUM(current_size) as count
      FROM classwaves.sessions.student_groups  
      GROUP BY session_id
    ) actual_members_count ON cs.id = actual_members_count.session_id
    LEFT JOIN (
      SELECT session_id, COUNT(*) as count
      FROM classwaves.sessions.student_groups
      WHERE leader_id IS NOT NULL
      GROUP BY session_id
    ) actual_leaders_count ON cs.id = actual_leaders_count.session_id
    WHERE (sm.planned_groups IS NULL OR sm.planned_members IS NULL OR sm.planned_leaders IS NULL)
      AND cs.status IN ('active', 'paused', 'ended', 'archived')
    ORDER BY cs.created_at DESC
    LIMIT ?
  `;

  return await databricksService.query(query, [limit]);
}

function calculatePlannedData(session: LegacySession) {
  // For legacy sessions, assume planned = actual (perfect adherence)
  const plannedData = {
    planned_groups: session.actual_groups,
    planned_group_size: session.actual_groups > 0 ? Math.round(session.actual_members / session.actual_groups) : 4,
    planned_duration_minutes: session.actual_duration_minutes || DEFAULT_PLANNED_DURATION,
    planned_members: session.actual_members,
    planned_leaders: session.actual_leaders,
    planned_vs_actual_adherence_pct: 100.0, // Perfect adherence assumed
    configured_at: session.started_at || new Date(),
  };

  return plannedData;
}

async function executeBackfill(sessions: LegacySession[], stats: BackfillStats, batchSize: number): Promise<void> {
  const batches = Math.ceil(sessions.length / batchSize);
  
  for (let i = 0; i < batches; i++) {
    const start = i * batchSize;
    const end = Math.min(start + batchSize, sessions.length);
    const batch = sessions.slice(start, end);
    
    console.log(`   Processing batch ${i + 1}/${batches} (${batch.length} sessions)...`);
    
    for (const session of batch) {
      try {
        await backfillSession(session);
        stats.updated++;
        
        if (stats.updated % 10 === 0) {
          console.log(`     ✅ Updated ${stats.updated}/${stats.toUpdate} sessions`);
        }
      } catch (error) {
        console.error(`     ❌ Failed to update session ${session.id}:`, error);
        stats.errors++;
      }
    }
    
    // Small delay between batches to avoid overwhelming the database
    if (i < batches - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

async function backfillSession(session: LegacySession): Promise<void> {
  const plannedData = calculatePlannedData(session);
  
  // Check if session_metrics record exists
  const existingMetrics = await databricksService.queryOne(`
    SELECT session_id FROM classwaves.analytics.session_metrics 
    WHERE session_id = ?
  `, [session.id]);
  
  if (existingMetrics) {
    // Update existing record
    const updateQuery = `
      UPDATE classwaves.analytics.session_metrics
      SET 
        planned_groups = ?,
        planned_group_size = ?,
        planned_duration_minutes = ?,
        planned_members = ?,
        planned_leaders = ?,
        planned_vs_actual_adherence_pct = ?,
        configured_at = ?,
        backfilled_at = CURRENT_TIMESTAMP()
      WHERE session_id = ?
    `;
    
    await databricksService.query(updateQuery, [
      plannedData.planned_groups,
      plannedData.planned_group_size,
      plannedData.planned_duration_minutes,
      plannedData.planned_members,
      plannedData.planned_leaders,
      plannedData.planned_vs_actual_adherence_pct,
      plannedData.configured_at,
      session.id
    ]);
  } else {
    // Insert new record
    const insertQuery = `
      INSERT INTO classwaves.analytics.session_metrics (
        session_id,
        planned_groups,
        planned_group_size,
        planned_duration_minutes,
        planned_members,
        planned_leaders,
        planned_vs_actual_adherence_pct,
        configured_at,
        backfilled_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
    `;
    
    await databricksService.query(insertQuery, [
      session.id,
      plannedData.planned_groups,
      plannedData.planned_group_size,
      plannedData.planned_duration_minutes,
      plannedData.planned_members,
      plannedData.planned_leaders,
      plannedData.planned_vs_actual_adherence_pct,
      plannedData.configured_at
    ]);
  }
}

async function askForConfirmation(): Promise<boolean> {
  return new Promise((resolve) => {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('⚠️  Do you want to proceed with the backfill? (y/N): ', (answer: string) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

function printFinalReport(stats: BackfillStats, isDryRun: boolean): void {
  console.log('\n📋 Final Report:');
  console.log('================');
  console.log(`Total Sessions: ${stats.totalSessions}`);
  console.log(`Legacy Sessions Found: ${stats.legacySessions}`);
  console.log(`Sessions Targeted: ${stats.toUpdate}`);
  
  if (!isDryRun) {
    console.log(`Sessions Updated: ${stats.updated}`);
    console.log(`Errors: ${stats.errors}`);
    
    if (stats.errors === 0 && stats.updated === stats.toUpdate) {
      console.log('\n✅ Backfill completed successfully!');
    } else if (stats.errors > 0) {
      console.log(`\n⚠️  Backfill completed with ${stats.errors} errors.`);
    }
  } else {
    console.log('\n🧪 Dry run completed successfully!');
  }
  
  console.log('\n💡 Next Steps:');
  console.log('   1. Test legacy session rendering in the frontend');
  console.log('   2. Verify analytics calculations work correctly');
  console.log('   3. Monitor for any JavaScript errors in production');
}

// Add to package.json scripts if not already present
function showUsageInstructions(): void {
  console.log('\n📚 Usage Instructions:');
  console.log('======================');
  console.log('Add this to package.json scripts section:');
  console.log('"backfill-planned-fields": "ts-node scripts/backfill-planned-fields.ts"');
  console.log('');
  console.log('Then run:');
  console.log('npm run backfill-planned-fields -- --dry-run    # Test run');
  console.log('npm run backfill-planned-fields -- --force      # Execute');
}

// Handle command line execution
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { main as backfillPlannedFields };

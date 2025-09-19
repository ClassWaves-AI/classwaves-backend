import * as dotenv from 'dotenv'
import { databricksService } from '../../services/databricks.service'
import { logger } from '../../utils/logger';

dotenv.config()

/**
 * Standardize timestamp columns across key tables
 * - Ensures `created_at` and `updated_at` TIMESTAMP columns exist where missing
 * - Idempotent: skips if columns already exist
 */
async function ensureTimestamps() {
  const targets: Array<{ schema: string; table: string; full: string }> = [
    // Sessions
    { schema: 'sessions', table: 'classroom_sessions', full: 'classwaves.sessions.classroom_sessions' },
    { schema: 'sessions', table: 'student_groups', full: 'classwaves.sessions.student_groups' },
    { schema: 'sessions', table: 'participants', full: 'classwaves.sessions.participants' },
    // Analytics
    { schema: 'analytics', table: 'session_events', full: 'classwaves.analytics.session_events' },
    { schema: 'analytics', table: 'session_metrics', full: 'classwaves.analytics.session_metrics' },
    { schema: 'analytics', table: 'group_metrics', full: 'classwaves.analytics.group_metrics' },
    // AI Insights
    { schema: 'ai_insights', table: 'teacher_guidance_metrics', full: 'classwaves.ai_insights.teacher_guidance_metrics' },
    { schema: 'ai_insights', table: 'analysis_results', full: 'classwaves.ai_insights.analysis_results' },
    { schema: 'ai_insights', table: 'tier1_analysis', full: 'classwaves.ai_insights.tier1_analysis' },
    { schema: 'ai_insights', table: 'tier2_analysis', full: 'classwaves.ai_insights.tier2_analysis' },
    { schema: 'ai_insights', table: 'session_guidance_analytics', full: 'classwaves.ai_insights.session_guidance_analytics' },
    { schema: 'ai_insights', table: 'session_summaries', full: 'classwaves.ai_insights.session_summaries' },
    { schema: 'ai_insights', table: 'teacher_prompt_effectiveness', full: 'classwaves.ai_insights.teacher_prompt_effectiveness' },
    // Users
    { schema: 'users', table: 'teachers', full: 'classwaves.users.teachers' },
    { schema: 'users', table: 'students', full: 'classwaves.users.students' },
  ]

  try {
    logger.debug('🔧 Standardizing timestamp columns on key tables...')
    await databricksService.connect()

    for (const t of targets) {
      try {
        logger.debug(`\n📋 Inspecting ${t.full}`)
        const desc = await databricksService.query(`DESCRIBE ${t.full}`)
        const cols = new Set((desc || []).map((r: any) => String(r.col_name || r.column_name || r.name)))

        const alters: string[] = []
        if (!cols.has('created_at')) {
          alters.push(`ALTER TABLE ${t.full} ADD COLUMN created_at TIMESTAMP`)
        }
        if (!cols.has('updated_at')) {
          alters.push(`ALTER TABLE ${t.full} ADD COLUMN updated_at TIMESTAMP`)
        }

        if (alters.length === 0) {
          logger.debug('✅ Timestamp columns already present')
          continue
        }

        for (const sql of alters) {
          try {
            await databricksService.query(sql)
            logger.debug('✅ Applied:', sql)
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            if (msg.includes('ALREADY_EXISTS') || msg.toLowerCase().includes('already exists')) {
              logger.debug('ℹ️  Column already exists, skipping:', sql)
            } else if (msg.includes('PARSE_SYNTAX_ERROR')) {
              logger.warn('⚠️  SQL compatibility error adding column; check warehouse settings:', msg)
            } else {
              logger.warn('⚠️  Failed to apply:', sql, '-', msg)
            }
          }
        }
      } catch (err) {
        logger.warn(`⚠️  Could not inspect/modify ${t.full}:`, err instanceof Error ? err.message : String(err))
      }
    }

    logger.debug('\n✨ Timestamp standardization completed')
  } catch (error) {
    logger.error('❌ Standardization failed:', error)
    process.exit(1)
  } finally {
    await databricksService.disconnect()
  }
}

if (require.main === module) {
  ensureTimestamps()
}

export { ensureTimestamps }

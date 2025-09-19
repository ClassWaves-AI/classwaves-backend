#!/usr/bin/env ts-node

import * as dotenv from 'dotenv';
import { databricksService } from '../services/databricks.service';
import { logger } from '../utils/logger';

dotenv.config();

async function addGoalSubjectColumns() {
  logger.debug('🔧 Ensuring goal and subject columns exist on sessions.classroom_sessions...');
  try {
    const rows = await databricksService.query('DESCRIBE classwaves.sessions.classroom_sessions');
    const cols = new Set((rows || []).map((r: any) => String(r.col_name)));

    if (!cols.has('goal')) {
      logger.debug('➕ Adding goal column...');
      await databricksService.query(`
        ALTER TABLE classwaves.sessions.classroom_sessions
        ADD COLUMN goal STRING COMMENT 'Learning goal/objectives for the session'
      `);
      logger.debug('✅ goal column added');
    } else {
      logger.debug('✅ goal column already exists');
    }

    if (!cols.has('subject')) {
      logger.debug('➕ Adding subject column...');
      await databricksService.query(`
        ALTER TABLE classwaves.sessions.classroom_sessions
        ADD COLUMN subject STRING COMMENT 'Subject area for the session'
      `);
      logger.debug('✅ subject column added');
    } else {
      logger.debug('✅ subject column already exists');
    }

    logger.debug('✨ Completed ensuring goal/subject columns');
  } catch (error) {
    logger.error('❌ Failed to add goal/subject columns:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  addGoalSubjectColumns();
}

export { addGoalSubjectColumns };

#!/usr/bin/env ts-node

import * as dotenv from 'dotenv';
import { databricksService } from '../services/databricks.service';

dotenv.config();

async function addGoalSubjectColumns() {
  console.log('🔧 Ensuring goal and subject columns exist on sessions.classroom_sessions...');
  try {
    const rows = await databricksService.query('DESCRIBE classwaves.sessions.classroom_sessions');
    const cols = new Set((rows || []).map((r: any) => String(r.col_name)));

    if (!cols.has('goal')) {
      console.log('➕ Adding goal column...');
      await databricksService.query(`
        ALTER TABLE classwaves.sessions.classroom_sessions
        ADD COLUMN goal STRING COMMENT 'Learning goal/objectives for the session'
      `);
      console.log('✅ goal column added');
    } else {
      console.log('✅ goal column already exists');
    }

    if (!cols.has('subject')) {
      console.log('➕ Adding subject column...');
      await databricksService.query(`
        ALTER TABLE classwaves.sessions.classroom_sessions
        ADD COLUMN subject STRING COMMENT 'Subject area for the session'
      `);
      console.log('✅ subject column added');
    } else {
      console.log('✅ subject column already exists');
    }

    console.log('✨ Completed ensuring goal/subject columns');
  } catch (error) {
    console.error('❌ Failed to add goal/subject columns:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  addGoalSubjectColumns();
}

export { addGoalSubjectColumns };


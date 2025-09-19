#!/usr/bin/env ts-node

import * as dotenv from 'dotenv';
import { databricksService } from '../services/databricks.service';
import { logger } from '../utils/logger';

dotenv.config();

async function detailedSchemaAudit() {
  logger.debug('🔍 Detailed Schema Audit for Session Creation Error...\n');

  try {
    // Check sessions.classroom_sessions table (where the error is occurring)
    logger.debug('📊 SESSIONS.CLASSROOM_SESSIONS TABLE:');
    const classroomSessionsSchema = await databricksService.query(
      'DESCRIBE classwaves.sessions.classroom_sessions'
    );
    
    logger.debug('Current columns:');
    classroomSessionsSchema.forEach((row: any) => {
      logger.debug(`  - ${row.col_name}: ${row.data_type} ${row.comment ? '(' + row.comment + ')' : ''}`);
    });

    const classroomColumns = classroomSessionsSchema.map((row: any) => row.col_name);
    
    // Check which columns the code expects vs what exists
    const expectedColumns = [
      'engagement_score',
      'participation_rate', 
      'access_code',
      'end_reason',
      'teacher_notes'
    ];

    logger.debug('\n🔍 COLUMN ANALYSIS:');
    expectedColumns.forEach(col => {
      const exists = classroomColumns.includes(col);
      logger.debug(`  ${exists ? '✅' : '❌'} ${col}: ${exists ? 'EXISTS' : 'MISSING'}`);
    });

    // Also check sessions.student_groups (we fixed this one)
    logger.debug('\n📊 SESSIONS.STUDENT_GROUPS TABLE (for comparison):');
    const studentGroupsSchema = await databricksService.query(
      'DESCRIBE classwaves.sessions.student_groups'
    );
    
    const groupColumns = studentGroupsSchema.map((row: any) => row.col_name);
    const groupExpectedColumns = ['leader_id', 'is_ready', 'sentiment_arc'];
    
    logger.debug('Fixed columns status:');
    groupExpectedColumns.forEach(col => {
      const exists = groupColumns.includes(col);
      logger.debug(`  ${exists ? '✅' : '❌'} ${col}: ${exists ? 'EXISTS' : 'MISSING'}`);
    });

    // Show the exact CREATE TABLE statement expected vs actual
    logger.debug('\n📝 CODE EXPECTATIONS vs REALITY:');
    logger.debug('The createSession function tries to insert these fields:');
    logger.debug('  - engagement_score: 0.0');
    logger.debug('  - total_groups: groupPlan.groups.length');
    logger.debug('  - total_students: [calculated]');
    logger.debug('  - access_code: [generated]');
    logger.debug('  - end_reason: ""');
    logger.debug('  - teacher_notes: ""');

  } catch (error) {
    logger.error('❌ Error during schema audit:', error);
    throw error;
  }
}

// Run the audit
detailedSchemaAudit()
  .then(() => {
    logger.debug('\n🎉 Schema audit completed');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('💥 Schema audit failed:', error);
    process.exit(1);
  });
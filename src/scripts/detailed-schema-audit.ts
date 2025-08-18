#!/usr/bin/env ts-node

import * as dotenv from 'dotenv';
import { databricksService } from '../services/databricks.service';

dotenv.config();

async function detailedSchemaAudit() {
  console.log('🔍 Detailed Schema Audit for Session Creation Error...\n');

  try {
    // Check sessions.classroom_sessions table (where the error is occurring)
    console.log('📊 SESSIONS.CLASSROOM_SESSIONS TABLE:');
    const classroomSessionsSchema = await databricksService.query(
      'DESCRIBE classwaves.sessions.classroom_sessions'
    );
    
    console.log('Current columns:');
    classroomSessionsSchema.forEach((row: any) => {
      console.log(`  - ${row.col_name}: ${row.data_type} ${row.comment ? '(' + row.comment + ')' : ''}`);
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

    console.log('\n🔍 COLUMN ANALYSIS:');
    expectedColumns.forEach(col => {
      const exists = classroomColumns.includes(col);
      console.log(`  ${exists ? '✅' : '❌'} ${col}: ${exists ? 'EXISTS' : 'MISSING'}`);
    });

    // Also check sessions.student_groups (we fixed this one)
    console.log('\n📊 SESSIONS.STUDENT_GROUPS TABLE (for comparison):');
    const studentGroupsSchema = await databricksService.query(
      'DESCRIBE classwaves.sessions.student_groups'
    );
    
    const groupColumns = studentGroupsSchema.map((row: any) => row.col_name);
    const groupExpectedColumns = ['leader_id', 'is_ready', 'sentiment_arc'];
    
    console.log('Fixed columns status:');
    groupExpectedColumns.forEach(col => {
      const exists = groupColumns.includes(col);
      console.log(`  ${exists ? '✅' : '❌'} ${col}: ${exists ? 'EXISTS' : 'MISSING'}`);
    });

    // Show the exact CREATE TABLE statement expected vs actual
    console.log('\n📝 CODE EXPECTATIONS vs REALITY:');
    console.log('The createSession function tries to insert these fields:');
    console.log('  - engagement_score: 0.0');
    console.log('  - total_groups: groupPlan.groups.length');
    console.log('  - total_students: [calculated]');
    console.log('  - access_code: [generated]');
    console.log('  - end_reason: ""');
    console.log('  - teacher_notes: ""');

  } catch (error) {
    console.error('❌ Error during schema audit:', error);
    throw error;
  }
}

// Run the audit
detailedSchemaAudit()
  .then(() => {
    console.log('\n🎉 Schema audit completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Schema audit failed:', error);
    process.exit(1);
  });

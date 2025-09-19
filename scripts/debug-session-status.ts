#!/usr/bin/env ts-node

import { DatabricksService } from '../src/services/databricks.service';
import { databricksConfig } from '../src/config/databricks.config';

async function debugSessionStatus() {
  const databricksService = new DatabricksService();
  
  try {
    console.log('🔍 Checking session status for session: fdaf27c9-3f1c-4a43-a67f-944feec428aa');
    
    // Check the specific session
    const session = await databricksService.queryOne(
      `SELECT id, title, status, teacher_id, created_at, updated_at 
       FROM ${databricksConfig.catalog}.sessions.classroom_sessions 
       WHERE id = ?`,
      ['fdaf27c9-3f1c-4a43-a67f-944feec428aa']
    );
    
    if (session) {
      console.log('✅ Session found:', {
        id: session.id,
        title: session.title,
        status: session.status,
        teacherId: session.teacher_id,
        createdAt: session.created_at,
        updatedAt: session.updated_at
      });
      
      // Check if there are any groups for this session
      const groups = await databricksService.query(
        `SELECT id, name, status, is_ready, current_size, max_size
         FROM ${databricksConfig.catalog}.sessions.student_groups 
         WHERE session_id = ?`,
        ['fdaf27c9-3f1c-4a43-a67f-944feec428aa']
      );
      
      console.log(`📊 Found ${groups.length} groups for session:`, groups);
      
      // Check session status transitions
      console.log('\n🔍 Checking session status validation logic...');
      if (session.status === 'created' || session.status === 'paused') {
        console.log('✅ Session can be started (status is valid)');
      } else {
        console.log(`❌ Session cannot be started (status: ${session.status})`);
        console.log('   Only sessions with status "created" or "paused" can be started');
      }
      
    } else {
      console.log('❌ Session not found');
    }
    
    // Check all sessions for this teacher to see if there are multiple sessions
    if (session?.teacher_id) {
      console.log('\n🔍 Checking all sessions for teacher:', session.teacher_id);
      const allSessions = await databricksService.query(
        `SELECT id, title, status, created_at 
         FROM ${databricksConfig.catalog}.sessions.classroom_sessions 
         WHERE teacher_id = ? 
         ORDER BY created_at DESC`,
        [session.teacher_id]
      );
      
      console.log(`📊 Found ${allSessions.length} total sessions for teacher:`, allSessions);
    }
    
  } catch (error) {
    console.error('❌ Error debugging session status:', error);
  } finally {
    await databricksService.disconnect();
  }
}

if (require.main === module) {
  debugSessionStatus().catch(console.error);
}

#!/usr/bin/env ts-node

import { databricksService } from '../src/services/databricks.service';

async function makeMaxStudentsNullable() {
  try {
    console.log('🔧 Making max_students column nullable...');
    
    // Connect to Databricks
    await databricksService.connect();
    console.log('✅ Connected to Databricks');
    
    // Execute the ALTER TABLE command
    const sql = `ALTER TABLE classwaves.sessions.classroom_sessions ALTER COLUMN max_students DROP NOT NULL`;
    
    console.log('Executing:', sql);
    await databricksService.query(sql);
    
    console.log('✅ Successfully made max_students column nullable');
    
    // Verify the change by describing the table
    console.log('\n📊 Verifying table structure...');
    const description = await databricksService.query('DESCRIBE classwaves.sessions.classroom_sessions');
    
    console.log('\nTable structure:');
    console.table(description);
    
  } catch (error) {
    console.error('❌ Error making max_students nullable:', error);
    process.exit(1);
  } finally {
    await databricksService.disconnect();
    console.log('🔒 Disconnected from Databricks');
  }
}

makeMaxStudentsNullable();

/**
 * Comprehensive Schema Audit Script
 * 
 * This script documents all database schemas, tables, and columns
 * to help understand the proper data flow for session metrics.
 */

import dotenv from 'dotenv';
dotenv.config();

import { databricksService } from '../src/services/databricks.service';
import fs from 'fs';
import path from 'path';

interface TableInfo {
  schema: string;
  tableName: string;
  columns: ColumnInfo[];
  rowCount?: number;
  lastUpdated?: string;
}

interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  comment?: string;
}

async function getAllSchemas(): Promise<string[]> {
  console.log('🔍 Discovering all schemas...');
  
  try {
    const result = await databricksService.query(`SHOW SCHEMAS IN classwaves`);
    const schemas = result.map((row: any) => row.databaseName || row.namespace || row.schema_name);
    console.log(`   Found schemas: ${schemas.join(', ')}`);
    return schemas;
  } catch (error) {
    console.log('   ⚠️  Using known schemas (query failed)');
    return ['users', 'sessions', 'analytics', 'compliance'];
  }
}

async function getTablesInSchema(schema: string): Promise<string[]> {
  console.log(`🔍 Discovering tables in schema: ${schema}`);
  
  try {
    const result = await databricksService.query(`SHOW TABLES IN classwaves.${schema}`);
    const tables = result.map((row: any) => row.tableName || row.table_name);
    console.log(`   Found ${tables.length} tables: ${tables.join(', ')}`);
    return tables;
  } catch (error) {
    console.log(`   ⚠️  Could not query schema ${schema}: ${error}`);
    return [];
  }
}

async function getTableColumns(schema: string, tableName: string): Promise<ColumnInfo[]> {
  console.log(`🔍 Getting columns for ${schema}.${tableName}`);
  
  try {
    const result = await databricksService.query(`DESCRIBE TABLE classwaves.${schema}.${tableName}`);
    
    const columns: ColumnInfo[] = result.map((row: any) => ({
      name: row.col_name || row.column_name || row.name,
      type: row.data_type || row.type,
      nullable: row.nullable !== 'false' && row.nullable !== false,
      comment: row.comment || undefined
    })).filter(col => col.name && !col.name.startsWith('#')); // Filter out metadata rows
    
    console.log(`   Found ${columns.length} columns`);
    return columns;
  } catch (error) {
    console.log(`   ⚠️  Could not describe table ${schema}.${tableName}: ${error}`);
    return [];
  }
}

async function getTableRowCount(schema: string, tableName: string): Promise<{ rowCount?: number; lastUpdated?: string }> {
  try {
    // Skip information_schema tables as they can be very large and slow
    if (schema === 'information_schema') {
      return { rowCount: undefined, lastUpdated: undefined };
    }

    console.log(`📊 Getting row count for ${schema}.${tableName}`);
    
    // Get row count with a reasonable timeout
    const countResult = await databricksService.query(
      `SELECT COUNT(*) as row_count FROM classwaves.${schema}.${tableName} LIMIT 1000000`
    );
    
    const rowCount = countResult?.[0]?.row_count || 0;
    console.log(`   Row count: ${rowCount.toLocaleString()}`);

    // Try to get last updated time if table has updated_at or similar column
    let lastUpdated: string | undefined;
    try {
      const updateResult = await databricksService.query(
        `SELECT MAX(updated_at) as last_updated FROM classwaves.${schema}.${tableName}`
      );
      lastUpdated = updateResult?.[0]?.last_updated;
    } catch {
      // Try created_at if updated_at doesn't exist
      try {
        const createResult = await databricksService.query(
          `SELECT MAX(created_at) as last_updated FROM classwaves.${schema}.${tableName}`
        );
        lastUpdated = createResult?.[0]?.last_updated;
      } catch {
        // No timestamp columns found
        lastUpdated = undefined;
      }
    }

    return { rowCount, lastUpdated };
  } catch (error) {
    console.log(`   ⚠️  Could not get row count for ${schema}.${tableName}: ${error}`);
    return { rowCount: undefined, lastUpdated: undefined };
  }
}

async function generateSchemaDocumentation(): Promise<void> {
  console.log('🏗️  Comprehensive Schema Audit');
  console.log('================================');
  
  const allTables: TableInfo[] = [];
  
  try {
    // Get all schemas
    const schemas = await getAllSchemas();
    
    // For each schema, get all tables and their columns
    for (const schema of schemas) {
      const tables = await getTablesInSchema(schema);
      
      for (const tableName of tables) {
        const columns = await getTableColumns(schema, tableName);
        const { rowCount, lastUpdated } = await getTableRowCount(schema, tableName);
        
        allTables.push({
          schema,
          tableName,
          columns,
          rowCount,
          lastUpdated
        });
      }
    }
    
    // Generate markdown documentation
    const markdown = generateMarkdownReport(allTables);
    
    // Write to file
    const outputPath = path.join(__dirname, '..', 'docs', 'DATABASE_SCHEMA_COMPLETE.md');
    fs.writeFileSync(outputPath, markdown);
    
    console.log(`✅ Schema documentation written to: ${outputPath}`);
    console.log(`📊 Total tables documented: ${allTables.length}`);
    
    // Generate session metrics analysis
    const sessionAnalysis = analyzeSessionMetrics(allTables);
    const analysisPath = path.join(__dirname, '..', 'docs', 'SESSION_METRICS_ANALYSIS.md');
    fs.writeFileSync(analysisPath, sessionAnalysis);
    
    console.log(`✅ Session metrics analysis written to: ${analysisPath}`);
    
  } catch (error) {
    console.error('❌ Schema audit failed:', error);
    throw error;
  }
}

function generateDataVolumeSummary(tables: TableInfo[]): string {
  const tablesBySchema = tables.reduce((acc, table) => {
    if (!acc[table.schema]) acc[table.schema] = [];
    acc[table.schema].push(table);
    return acc;
  }, {} as Record<string, TableInfo[]>);

  let summary = `| Schema | Tables | Total Rows | Tables with Data | Last Activity |\n`;
  summary += `|--------|--------|------------|------------------|---------------|\n`;

  for (const [schema, schemaTables] of Object.entries(tablesBySchema)) {
    const totalRows = schemaTables
      .filter(t => t.rowCount !== undefined)
      .reduce((sum, t) => sum + (t.rowCount || 0), 0);
    
    const tablesWithData = schemaTables.filter(t => t.rowCount && t.rowCount > 0).length;
    
    const mostRecentActivity = schemaTables
      .filter(t => t.lastUpdated)
      .map(t => new Date(t.lastUpdated!))
      .sort((a, b) => b.getTime() - a.getTime())[0];

    const lastActivityStr = mostRecentActivity ? 
      mostRecentActivity.toISOString().split('T')[0] : 
      'Unknown';

    summary += `| \`${schema}\` | ${schemaTables.length} | ${totalRows.toLocaleString()} | ${tablesWithData} | ${lastActivityStr} |\n`;
  }

  return summary;
}

function generateMarkdownReport(tables: TableInfo[]): string {
  const timestamp = new Date().toISOString();
  
  let markdown = `# ClassWaves Database Schema Documentation

**Generated:** ${timestamp}
**Purpose:** Complete documentation of all database schemas, tables, and columns

## Overview

This document provides a comprehensive view of the ClassWaves database structure across all schemas.

**Total Tables:** ${tables.length}
**Schemas:** ${[...new Set(tables.map(t => t.schema))].join(', ')}

### Data Volume Summary

${generateDataVolumeSummary(tables)}

---

`;

  // Group tables by schema
  const tablesBySchema = tables.reduce((acc, table) => {
    if (!acc[table.schema]) acc[table.schema] = [];
    acc[table.schema].push(table);
    return acc;
  }, {} as Record<string, TableInfo[]>);

  // Generate documentation for each schema
  for (const [schema, schemaTables] of Object.entries(tablesBySchema)) {
    markdown += `## Schema: \`${schema}\`\n\n`;
    markdown += `**Tables:** ${schemaTables.length}\n\n`;
    
    for (const table of schemaTables) {
      markdown += `### Table: \`${table.tableName}\`\n\n`;
      markdown += `**Full Name:** \`classwaves.${schema}.${table.tableName}\`\n`;
      markdown += `**Columns:** ${table.columns.length}\n`;
      
      if (table.rowCount !== undefined) {
        markdown += `**Row Count:** ${table.rowCount.toLocaleString()}\n`;
      }
      
      if (table.lastUpdated) {
        const lastUpdatedDate = new Date(table.lastUpdated).toISOString().split('T')[0];
        markdown += `**Last Updated:** ${lastUpdatedDate}\n`;
      }
      
      markdown += `\n`;
      
      if (table.columns.length > 0) {
        markdown += `| Column | Type | Nullable | Comment |\n`;
        markdown += `|--------|------|----------|----------|\n`;
        
        for (const column of table.columns) {
          const nullable = column.nullable ? '✅' : '❌';
          const comment = column.comment || '';
          markdown += `| \`${column.name}\` | \`${column.type}\` | ${nullable} | ${comment} |\n`;
        }
        
        markdown += `\n`;
      } else {
        markdown += `*No columns found or table could not be described.*\n\n`;
      }
    }
    
    markdown += `---\n\n`;
  }

  return markdown;
}

function analyzeSessionMetrics(tables: TableInfo[]): string {
  const timestamp = new Date().toISOString();
  
  let analysis = `# Session Metrics Data Flow Analysis

**Generated:** ${timestamp}
**Purpose:** Analyze how session metrics should flow across different tables

## Key Tables for Session Data

`;

  // Find session-related tables
  const sessionTables = tables.filter(t => 
    t.tableName.toLowerCase().includes('session') || 
    t.tableName.toLowerCase().includes('classroom') ||
    t.tableName.toLowerCase().includes('metrics') ||
    t.tableName.toLowerCase().includes('analytics')
  );

  analysis += `**Session-Related Tables Found:** ${sessionTables.length}\n\n`;

  for (const table of sessionTables) {
    analysis += `### \`${table.schema}.${table.tableName}\`\n\n`;
    
    // Look for group-related columns
    const groupColumns = table.columns.filter(c => 
      c.name.toLowerCase().includes('group') || 
      c.name.toLowerCase().includes('student') ||
      c.name.toLowerCase().includes('participant')
    );
    
    if (groupColumns.length > 0) {
      analysis += `**Group/Student Related Columns:**\n`;
      for (const col of groupColumns) {
        analysis += `- \`${col.name}\` (${col.type}) - ${col.comment || 'No comment'}\n`;
      }
      analysis += `\n`;
    }
    
    // Look for metrics columns
    const metricsColumns = table.columns.filter(c => 
      c.name.toLowerCase().includes('total') || 
      c.name.toLowerCase().includes('count') ||
      c.name.toLowerCase().includes('avg') ||
      c.name.toLowerCase().includes('score') ||
      c.name.toLowerCase().includes('rate')
    );
    
    if (metricsColumns.length > 0) {
      analysis += `**Metrics Columns:**\n`;
      for (const col of metricsColumns) {
        analysis += `- \`${col.name}\` (${col.type}) - ${col.comment || 'No comment'}\n`;
      }
      analysis += `\n`;
    }
    
    analysis += `**All Columns:**\n`;
    for (const col of table.columns) {
      analysis += `- \`${col.name}\` (${col.type})\n`;
    }
    analysis += `\n---\n\n`;
  }

  // Generate recommendations
  analysis += `## Recommendations for session.controller.ts

Based on the schema analysis, here are the recommended data flows:

### 1. Primary Session Data
- **Table:** \`sessions.classroom_sessions\`
- **Purpose:** Main session record with basic info and group counts
- **Key Columns:** Look for \`total_groups\`, \`max_students\`, etc.

### 2. Session Metrics
- **Table:** \`users.session_metrics\` (if exists)
- **Purpose:** Calculated metrics and analytics
- **Key Columns:** Derived metrics, scores, rates

### 3. Session Events
- **Table:** \`analytics.session_events\`
- **Purpose:** Timeline of session events
- **Key Columns:** Event tracking, timestamps

### 4. Analytics Cache
- **Table:** \`users.session_analytics_cache\`
- **Purpose:** Pre-calculated analytics for performance
- **Key Columns:** Cached metrics, aggregated data

## Action Items

1. **Fix Column References:** Update session.controller.ts to use correct column names
2. **Data Flow Mapping:** Map each metric to its proper table
3. **Validation:** Ensure all referenced columns actually exist
4. **Testing:** Verify data flows work end-to-end

`;

  return analysis;
}

// Run the audit
if (require.main === module) {
  generateSchemaDocumentation()
    .then(() => {
      console.log('🎉 Schema audit completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Schema audit failed:', error);
      process.exit(1);
    });
}

export { generateSchemaDocumentation };

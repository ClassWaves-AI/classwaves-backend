#!/usr/bin/env ts-node
import * as dotenv from 'dotenv';
dotenv.config();

import { databricksService } from '../services/databricks.service';

async function columnExists(fullTable: string, name: string): Promise<boolean> {
  const rows = await databricksService.query(`DESCRIBE ${fullTable}`);
  return Array.isArray(rows) && rows.some((r: any) => String(r.col_name).toLowerCase() === name.toLowerCase());
}

async function run(sessionId: string, groupId: string) {
  const out: any = { sessionId, groupId };
  const transcriptsTable = 'classwaves.sessions.transcriptions';
  const groupSummariesTable = 'classwaves.ai_insights.group_summaries';

  // Transcriptions
  try {
    const hasContent = await columnExists(transcriptsTable, 'content');
    const hasText = await columnExists(transcriptsTable, 'text');
    const hasCreatedAt = await columnExists(transcriptsTable, 'created_at');
    const hasStartTime = await columnExists(transcriptsTable, 'start_time');
    const textCol = hasContent ? 'content' : (hasText ? 'text' : null);
    const timeCol = hasCreatedAt ? 'created_at' : (hasStartTime ? 'start_time' : null);
    const selectCols = ['id', 'session_id', 'group_id'];
    if (textCol) selectCols.push(`${textCol} as transcript_text`);
    if (timeCol) selectCols.push(`${timeCol} as ts`);
    const orderClause = timeCol ? `ORDER BY ${timeCol} DESC` : '';
    const sql = `SELECT ${selectCols.join(', ')} FROM ${transcriptsTable} WHERE session_id = ? AND group_id = ? ${orderClause} LIMIT 5`;
    const rows = await databricksService.query(sql, [sessionId, groupId]);
    let count = Array.isArray(rows) ? rows.length : 0;
    let latest = Array.isArray(rows) && rows.length ? rows[0] : null;
    // Fallback: search by group only if no results
    if (count === 0) {
      const fallbackSql = `SELECT ${selectCols.join(', ')} FROM ${transcriptsTable} WHERE group_id = ? ${orderClause} LIMIT 5`;
      const rows2 = await databricksService.query(fallbackSql, [groupId]);
      count = Array.isArray(rows2) ? rows2.length : 0;
      latest = Array.isArray(rows2) && rows2.length ? rows2[0] : null;
    }
    out.transcriptions = { count, latest };
  } catch (e) {
    out.transcriptions = { error: (e as Error).message };
  }

  // Group summaries
  try {
    const hasSummaryJson = await columnExists(groupSummariesTable, 'summary_json');
    const hasAnalysisTs = await columnExists(groupSummariesTable, 'analysis_timestamp');
    const selectCols = ['id', 'session_id', 'group_id'];
    if (hasSummaryJson) selectCols.push('summary_json');
    if (hasAnalysisTs) selectCols.push('analysis_timestamp');
    const orderClause = hasAnalysisTs ? 'ORDER BY analysis_timestamp DESC' : '';
    const sql = `SELECT ${selectCols.join(', ')} FROM ${groupSummariesTable} WHERE session_id = ? AND group_id = ? ${orderClause} LIMIT 5`;
    const rows = await databricksService.query(sql, [sessionId, groupId]);
    let gCount = Array.isArray(rows) ? rows.length : 0;
    let gLatest = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (gCount === 0) {
      const fallbackSql = `SELECT ${selectCols.join(', ')} FROM ${groupSummariesTable} WHERE group_id = ? ${orderClause} LIMIT 5`;
      const rows2 = await databricksService.query(fallbackSql, [groupId]);
      gCount = Array.isArray(rows2) ? rows2.length : 0;
      gLatest = Array.isArray(rows2) && rows2.length ? rows2[0] : null;
    }
    out.groupSummaries = { count: gCount, latest: gLatest };
  } catch (e) {
    out.groupSummaries = { error: (e as Error).message };
  }

  console.log(JSON.stringify(out, null, 2));
}

const [, , sessionId, groupId] = process.argv;
if (!sessionId || !groupId) {
  console.error('Usage: ts-node src/scripts/check-transcripts-summaries.ts <sessionId> <groupId>');
  process.exit(1);
}

run(sessionId, groupId).catch((e) => {
  console.error('Failed:', e);
  process.exit(1);
});

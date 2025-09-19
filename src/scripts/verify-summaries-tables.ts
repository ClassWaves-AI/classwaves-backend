import axios from 'axios';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

const HOST = (process.env.DATABRICKS_HOST || process.env.DATABRICKS_WORKSPACE_URL || '').replace(/\/$/, '');
const TOKEN = process.env.DATABRICKS_TOKEN || '';
const WAREHOUSE = process.env.DATABRICKS_WAREHOUSE_ID || '';
const CATALOG = process.env.DATABRICKS_CATALOG || 'classwaves';

if (!HOST || !TOKEN || !WAREHOUSE) {
  logger.error('Missing Databricks configuration. Ensure DATABRICKS_HOST, DATABRICKS_TOKEN, and DATABRICKS_WAREHOUSE_ID are set.');
  process.exit(1);
}

const http = axios.create({
  baseURL: HOST,
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  },
  timeout: 20000,
});

async function exec(statement: string) {
  const start = await http.post('/api/2.0/sql/statements', {
    warehouse_id: WAREHOUSE,
    statement,
    wait_timeout: '20s',
  });
  const data = start.data;
  if (data.status?.state === 'SUCCEEDED') return data.result;
  if (data.status?.state === 'FAILED') throw new Error(data.status?.error?.message || 'FAILED');
  const id = data.statement_id;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const res = await http.get(`/api/2.0/sql/statements/${id}`);
    const st = res.data.status?.state;
    if (st === 'SUCCEEDED') return res.data.result;
    if (st === 'FAILED') throw new Error(res.data.status?.error?.message || 'FAILED');
  }
  throw new Error('TIMEOUT');
}

async function verifyTable(schema: string, table: string, expected: string[]) {
  const fq = `${CATALOG}.${schema}.${table}`;
  try {
    const desc = await exec(`DESCRIBE TABLE ${fq}`);
    const cols = (desc?.data_array || []).map((row: any[]) => String(row[0])).filter((n: string) => n && !n.startsWith('#'));
    const missing = expected.filter((c) => !cols.includes(c));
    logger.debug(`\nTable: ${fq}`);
    logger.debug(`Columns: ${cols.join(', ')}`);
    if (missing.length === 0) {
      logger.debug('✅ All expected columns present');
    } else {
      logger.debug('❌ Missing columns:', missing.join(', '));
      process.exitCode = 2;
    }
  } catch (e: any) {
    logger.error(`❌ Failed to verify ${fq}:`, e?.message || e);
    process.exitCode = 2;
  }
}

async function main() {
  logger.debug('🔎 Verifying summaries tables in catalog', CATALOG);
  await exec(`USE CATALOG ${CATALOG}`);
  await verifyTable('ai_insights', 'group_summaries', ['id', 'session_id', 'group_id', 'summary_json', 'analysis_timestamp', 'created_at']);
  await verifyTable('ai_insights', 'session_summaries', ['id', 'session_id', 'summary_json', 'analysis_timestamp', 'created_at']);
}

main().catch((e) => { logger.error('Unexpected error:', e); process.exit(1); });

import { redisService } from '../services/redis.service';
import { databricksService } from '../services/databricks.service';

const DLQ_KEY = process.env.AUDIT_LOG_DLQ_KEY || 'audit:log:dlq';
const STREAM_KEY = process.env.AUDIT_LOG_STREAM_KEY || 'audit:log';
const MODE = (process.env.AUDIT_DLQ_REPLAY_MODE || 'stream') as 'stream' | 'db';
const BATCH = parseInt(process.env.AUDIT_DLQ_REPLAY_BATCH || '200', 10);

async function main(): Promise<void> {
  const client = redisService.getClient();
  console.log(`🔁 DLQ replay starting (mode=${MODE})`);
  let cursor: string | null = '0-0';
  let processed = 0;
  while (cursor) {
    // XRANGE with COUNT
    const args: any[] = ['XRANGE', DLQ_KEY, cursor, '+', 'COUNT', BATCH];
    const res = (await (client as any).call(...args)) as Array<[string, string[]]>;
    if (!res || res.length === 0) break;

    if (MODE === 'stream') {
      for (const [id, kv] of res) {
        const obj: Record<string, string> = {};
        for (let i = 0; i < kv.length; i += 2) obj[kv[i]] = kv[i + 1];
        try {
          const payload = JSON.parse(obj.payload || '{}');
          const fields: string[] = [];
          for (const [k, v] of Object.entries(payload)) {
            fields.push(k, typeof v === 'string' ? v : String(v));
          }
          await client.xadd(STREAM_KEY, '*', ...fields);
          await client.xdel(DLQ_KEY, id);
          processed++;
        } catch (e) {
          console.warn('DLQ replay stream failed for id', id, e);
        }
      }
    } else {
      // MODE === 'db' : write rows directly
      const rows: Record<string, any>[] = [];
      const idsToDel: string[] = [];
      for (const [id, kv] of res) {
        const obj: Record<string, string> = {};
        for (let i = 0; i < kv.length; i += 2) obj[kv[i]] = kv[i + 1];
        try {
          const row = JSON.parse(obj.payload || '{}');
          rows.push(row);
          idsToDel.push(id);
        } catch (e) {
          console.warn('DLQ parse failed for id', id, e);
        }
      }
      if (rows.length > 0) {
        try {
          await databricksService.batchInsert('audit_log', rows);
          await client.xdel(DLQ_KEY, ...idsToDel);
          processed += rows.length;
        } catch (e) {
          console.error('DLQ DB replay failed, stopping to avoid data loss', e);
          break;
        }
      }
    }
    const lastId = res[res.length - 1][0];
    // Increment range cursor: simplistic approach to move forward
    cursor = lastId;
    if (res.length < BATCH) break; // done
  }
  console.log(`✅ DLQ replay complete. processed=${processed}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('DLQ replay failed', e);
    process.exit(1);
  });
}


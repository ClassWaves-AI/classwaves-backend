import { redisService } from '../services/redis.service';
import { databricksService } from '../services/databricks.service';
import { createAuditSampler } from './audit-sampler';
import { createAuditRollups } from './audit-rollups';
import { incDbFailures, incDropped, incProcessed, incRollupFlushed, startMetricsLogger, stopMetricsLogger } from './audit-metrics';
import { logger } from '../utils/logger';

const STREAM_KEY = process.env.AUDIT_LOG_STREAM_KEY || 'audit:log';
const GROUP = process.env.AUDIT_LOG_CONSUMER_GROUP || 'auditlog';
const CONSUMER = process.env.AUDIT_LOG_CONSUMER_NAME || `${process.env.HOSTNAME || 'local'}-audit-worker`;
const BATCH_SIZE = parseInt(process.env.AUDIT_LOG_BATCH_SIZE || '200', 10);
const BLOCK_MS = parseInt(process.env.AUDIT_LOG_BLOCK_MS || '2000', 10);
const DB_COOLDOWN_MS = parseInt(process.env.AUDIT_LOG_DB_COOLDOWN_MS || '10000', 10);
const DLQ_KEY = process.env.AUDIT_LOG_DLQ_KEY || 'audit:log:dlq';

function minuteBucket(ts: Date): string {
  const d = new Date(ts);
  d.setSeconds(0, 0);
  return d.toISOString();
}

export class AuditLogWorker {
  private running = false;
  private dbCooldownUntil = 0;
  private lastRollupFlush = Date.now();

  async ensureGroup(): Promise<void> {
    const client = redisService.getClient();
    try {
      await client.xgroup('CREATE', STREAM_KEY, GROUP, '$', 'MKSTREAM');
      logger.debug(`✅ Created consumer group ${GROUP} on ${STREAM_KEY}`);
    } catch (e: any) {
      if (e?.message?.includes('BUSYGROUP')) {
        // exists
      } else {
        logger.warn('audit: xgroup create failed', e);
      }
    }
  }

  async getQueueDepth(): Promise<number> {
    try {
      const len = await redisService.getClient().xlen(STREAM_KEY);
      return typeof len === 'number' ? len : parseInt(String(len || 0), 10) || 0;
    } catch {
      return 0;
    }
  }

  async start(): Promise<void> {
    this.running = true;
    await this.ensureGroup();
    const sampler = createAuditSampler();
    const rollups = createAuditRollups();
    startMetricsLogger(() => this.getQueueDepth());
    logger.debug('🚀 AuditLogWorker started', { STREAM_KEY, GROUP, CONSUMER, BATCH_SIZE, BLOCK_MS });

    const client = redisService.getClient();

    while (this.running) {
      try {
        const res = (await (client as any).xreadgroup(
          'GROUP',
          GROUP,
          CONSUMER,
          'BLOCK',
          BLOCK_MS,
          'COUNT',
          BATCH_SIZE,
          'STREAMS',
          STREAM_KEY,
          '>'
        )) as any;

        if (!res || res.length === 0) {
          continue;
        }

        const entries = res[0][1] as Array<[string, string[]]>; // [id, [field, value, field, value, ...]]
        const rows: Record<string, any>[] = [];
        const rowPriorities: ('critical' | 'high' | 'normal' | 'low')[] = [];
        const ackIds: string[] = [];

        for (const [id, kv] of entries) {
          ackIds.push(id);
          const obj: Record<string, string> = {};
          for (let i = 0; i < kv.length; i += 2) obj[kv[i]] = kv[i + 1];

          const eventTimestamp = obj.event_timestamp ? new Date(obj.event_timestamp) : new Date();
          const priority = (obj.priority as any) || 'normal';
          const eventType = obj.event_type;
          const category = obj.event_category as any;
          const sessionId = obj.session_id || undefined;
          const schoolId = obj.school_id;

          // Sampling
          const decision = sampler.shouldKeep({
            eventCategory: category,
            eventType,
            sessionId,
            priority,
            eventTimestamp,
          });
          if (!decision.keep) {
            rollups.record({
              schoolId,
              sessionId,
              eventType,
              category,
              reason: decision.reason!,
              minuteBucket: minuteBucket(eventTimestamp),
            });
            incDropped(1);
            continue;
          }

          rows.push({
            id: `${schoolId}-${eventType}-${id}`,
            actor_id: obj.actor_id,
            actor_type: obj.actor_type,
            event_type: eventType,
            event_category: category,
            event_timestamp: eventTimestamp,
            resource_type: obj.resource_type,
            resource_id: obj.resource_id || null,
            school_id: schoolId,
            session_id: sessionId || null,
            description: obj.description || '',
            ip_address: obj.ip_address || null,
            user_agent: obj.user_agent || null,
            compliance_basis: obj.compliance_basis || null,
            data_accessed: obj.data_accessed || null,
            affected_student_ids: obj.affected_student_ids || null,
            created_at: new Date(),
          });
          rowPriorities.push(priority as any);
        }

        // Flush rollups periodically or if big
        const flushInterval = parseInt(process.env.AUDIT_ROLLUP_FLUSH_INTERVAL_MS || '60000', 10);
        const dueByTime = Date.now() - this.lastRollupFlush >= flushInterval;
        const flushRollupsNow = rollups.size() >= 50 || dueByTime;
        const rollupRows = flushRollupsNow ? rollups.flushToAuditRows() : [];
        if (rollupRows.length > 0) {
          try {
            await databricksService.recordAuditLogBatch(rollupRows as any);
            incRollupFlushed(rollupRows.length);
            this.lastRollupFlush = Date.now();
          } catch (e) {
            logger.warn('audit: rollup flush failed', e);
            // on failure, drop silently; we still ack below to avoid pile-up
          }
        }

        // Apply DB cooldown
        const now = Date.now();
        const inCooldown = now < this.dbCooldownUntil;
        if (rows.length > 0) {
          if (!inCooldown) {
            try {
              await databricksService.recordAuditLogBatch(rows as any);
              incProcessed(rows.length);
            } catch (e) {
              logger.error('audit: batch insert failed, entering cooldown', e);
              incDbFailures(1);
              this.dbCooldownUntil = Date.now() + DB_COOLDOWN_MS;
              // DLQ criticals
              for (let i = 0; i < rows.length; i++) {
                if (rowPriorities[i] === 'critical') {
                  await client.xadd(DLQ_KEY, '*', 'payload', JSON.stringify(rows[i]));
                }
              }
            }
          } else {
            // During cooldown, DLQ criticals
            for (let i = 0; i < rows.length; i++) {
              if (rowPriorities[i] === 'critical') {
                await client.xadd(DLQ_KEY, '*', 'payload', JSON.stringify(rows[i]));
              }
            }
          }
        }

        // Always ack to prevent pile-up
        for (const id of ackIds) {
          try {
            await client.xack(STREAM_KEY, GROUP, id);
          } catch (e) {
            logger.warn('audit: xack failed', e);
          }
        }
      } catch (loopErr) {
        logger.warn('audit worker loop error', loopErr);
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    stopMetricsLogger();
  }
}

// If executed directly, run the worker
if (require.main === module) {
  const worker = new AuditLogWorker();
  worker.start().catch((e) => {
    logger.error('audit worker failed to start', e);
    process.exitCode = 1;
  });
  const shutdown = async () => {
    logger.debug('🛑 Shutting down audit worker...');
    await worker.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
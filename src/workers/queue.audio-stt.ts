import { Queue } from 'bullmq';
import { redisService } from '../services/redis.service';

let queue: Queue | null = null;

export async function getAudioSttQueue(): Promise<Queue> {
  if (queue) return queue;
  // BullMQ prefers connection options over a shared client
  // Derive options from the existing client and disable per-command timeouts for blocking ops
  const base = redisService.getClient() as any;
  const baseOpts = { ...(base?.options || {}) };
  delete (baseOpts as any).commandTimeout; // avoid interfering with blocking commands used by BullMQ
  (baseOpts as any).maxRetriesPerRequest = null; // BullMQ requirement
  queue = new Queue('audio-stt', { connection: baseOpts as any });
  return queue;
}

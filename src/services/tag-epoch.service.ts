import { redisService } from './redis.service';

const PREFIX = 'tagver:'; // epoch key prefix

export function isEpochsEnabled(): boolean {
  // Enabled by default; disable by setting CW_CACHE_EPOCHS_ENABLED=0
  return process.env.CW_CACHE_EPOCHS_ENABLED !== '0';
}

export async function getTagEpoch(tag: string): Promise<number> {
  try {
    const val = await redisService.get(`${PREFIX}${tag}`);
    const n = val != null ? Number(val) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export async function getEpochs(tags: string[]): Promise<number[]> {
  return Promise.all(tags.map(getTagEpoch));
}

export async function bumpTagEpoch(tag: string): Promise<number> {
  try {
    return await redisService.getClient().incr(`${PREFIX}${tag}`);
  } catch {
    return 0;
  }
}

export async function composeEpochKey(baseKey: string, tags: string[]): Promise<string> {
  if (!tags.length) return baseKey;
  const epochs = await getEpochs(tags);
  const suffix = tags.map((t, i) => `${t}@${epochs[i]}`).join('|');
  return `${baseKey}::${suffix}`;
}

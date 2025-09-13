import type { IdempotencyPort } from '../services/idempotency.port';
import { RedisIdempotencyAdapter } from '../adapters/idempotency.redis';

let instance: IdempotencyPort | null = null;

export function getIdempotencyPort(): IdempotencyPort {
  if (!instance) instance = new RedisIdempotencyAdapter();
  return instance;
}

export const idempotencyPort: IdempotencyPort = getIdempotencyPort();


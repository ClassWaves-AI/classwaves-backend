/*
 * Lightweight structured logger with redaction and LOG_LEVEL support.
 * No external deps; outputs single-line JSON for easy ingestion.
 */

type Level = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVELS: Record<Exclude<Level, 'silent'>, number> = {
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

function currentLevel(): Level {
  const lvl = String(process.env.LOG_LEVEL || 'info').toLowerCase() as Level;
  return (['debug', 'info', 'warn', 'error', 'silent'] as Level[]).includes(lvl) ? lvl : 'info';
}

function levelEnabled(lvl: keyof typeof LEVELS): boolean {
  const cur = currentLevel();
  if (cur === 'silent') return false;
  return LEVELS[lvl] >= LEVELS[cur as keyof typeof LEVELS];
}

// Keys to redact in objects
const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'x-api-key',
  'secret',
  'sessionidtoken',
  'session_id',
  'sessionid',
  // PII and quasi-identifiers
  'email',
  'user-agent',
  'x-forwarded-for',
  'x-real-ip',
  'ip',
]);

function isObject(val: unknown): val is Record<string, unknown> {
  return !!val && typeof val === 'object' && !Array.isArray(val);
}

export function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    // Bearer tokens or JWT-like strings
    if (/^Bearer\s+/i.test(value)) return 'Bearer [REDACTED]';
    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return '[REDACTED_JWT]';
    // Email addresses
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return '[REDACTED_EMAIL]';
  }
  return value;
}

export function redactObject<T>(input: T, allowList: string[] = []): T {
  if (!isObject(input)) return input;
  const out: Record<string, unknown> = Array.isArray(input) ? ([] as unknown as Record<string, unknown>) : {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const lowered = k.toLowerCase();
    if (SENSITIVE_KEYS.has(lowered) && !allowList.includes(lowered)) {
      out[k] = '[REDACTED]';
      continue;
    }
    if (isObject(v)) out[k] = redactObject(v as Record<string, unknown>, allowList);
    else if (Array.isArray(v)) out[k] = v.map((i) => (isObject(i) ? redactObject(i as Record<string, unknown>, allowList) : redactValue(i)));
    else out[k] = redactValue(v);
  }
  return out as T;
}

function normalizeContext(ctx?: unknown): Record<string, unknown> | undefined {
  if (ctx == null) return undefined;
  if (isObject(ctx)) return ctx;
  return { value: ctx };
}

function write(level: Exclude<Level, 'silent'>, msg: string, ctx?: unknown) {
  if (!levelEnabled(level)) return;
  const base: Record<string, unknown> = {
    level,
    msg,
    timestamp: new Date().toISOString(),
  };
  const normalized = normalizeContext(ctx);
  const payload = normalized ? { ...base, ...redactObject(normalized) } : base;
  // Single-line JSON for log processors
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function toContext(args: unknown[]): unknown {
  if (args.length === 0) return undefined;
  if (args.length === 1) return args[0];
  return args;
}

export const logger = {
  debug: (msg: string, ...ctx: unknown[]) => write('debug', msg, toContext(ctx)),
  info: (msg: string, ...ctx: unknown[]) => write('info', msg, toContext(ctx)),
  warn: (msg: string, ...ctx: unknown[]) => write('warn', msg, toContext(ctx)),
  error: (msg: string, ...ctx: unknown[]) => write('error', msg, toContext(ctx)),
};

export type { Level };

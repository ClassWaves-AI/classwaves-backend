/**
 * Key prefix helper for Redis keys with environment namespace and safe segments.
 * Produces keys like: cw:{env}:{segment1}:{segment2}:...
 *
 * Segment sanitization keeps keys readable and scan-friendly by restricting to
 * [A-Za-z0-9._-]. Any other character is replaced with '_'.
 */

function encodeSegment(seg: string | number): string {
  const s = String(seg).trim();
  // Replace any character outside safe set with underscore to keep readability
  return s.replace(/[^A-Za-z0-9._-]/g, '_');
}

export function makeKey(...segments: Array<string | number | undefined | null>): string {
  const env = process.env.NODE_ENV || 'development';
  const flat = segments
    .filter((s): s is string | number => s !== undefined && s !== null)
    .map(encodeSegment)
    .join(':');
  return `cw:${env}:${flat}`;
}

/**
 * Utility to decide if the prefixed key strategy is enabled.
 */
export function isPrefixEnabled(): boolean {
  // Enabled by default; disable by setting CW_CACHE_PREFIX_ENABLED=0
  return process.env.CW_CACHE_PREFIX_ENABLED !== '0';
}

/**
 * Utility to decide if we should dual-write to legacy keys during migration.
 */
export function isDualWriteEnabled(): boolean {
  // Enabled by default for migration safety; disable by setting CW_CACHE_DUAL_WRITE=0
  return process.env.CW_CACHE_DUAL_WRITE !== '0';
}

import { gzipSync, gunzipSync } from 'zlib';

export function isCompressed(payload: string): boolean {
  return typeof payload === 'string' && payload.startsWith('gz:');
}

export function compressString(input: string): string {
  const gz = gzipSync(Buffer.from(input, 'utf8'));
  return 'gz:' + gz.toString('base64');
}

export function decompressToString(input: string): string {
  if (!isCompressed(input)) return input;
  const b64 = input.slice(3);
  const buf = Buffer.from(b64, 'base64');
  return gunzipSync(buf).toString('utf8');
}


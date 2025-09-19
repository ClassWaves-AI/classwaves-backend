#!/usr/bin/env node
// Generates a test JWT for teacher auth (HS256 fallback)
// Usage: node scripts/synthetic/teacher-login.js --env local --userId <uuid> --schoolId <uuid>

const crypto = require('crypto');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { env: 'local' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--env') out.env = args[++i] || 'local';
    else if (a === '--userId') out.userId = args[++i];
    else if (a === '--email') out.email = args[++i];
    else if (a === '--schoolId') out.schoolId = args[++i];
    else if (a === '--role') out.role = args[++i];
    else if (a === '--sessionId') out.sessionId = args[++i];
  }
  return out;
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signHS256(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const data = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${data}.${sig}`;
}

async function main() {
  const args = parseArgs();
  const secret = process.env.JWT_SECRET || 'classwaves-jwt-secret';
  const nowSec = Math.floor(Date.now() / 1000);
  const userId = args.userId || '00000000-0000-0000-0000-000000000001';
  const schoolId = args.schoolId || '00000000-0000-0000-0000-000000000002';
  const sessionId = args.sessionId || crypto.randomBytes(16).toString('hex');
  const email = args.email || 'teacher@example.com';
  const role = args.role || 'teacher';

  const payload = {
    userId,
    email,
    schoolId,
    role,
    sessionId,
    type: 'access',
    iat: nowSec,
    exp: nowSec + 60 * 60, // 1 hour
  };

  const token = signHS256(payload, secret);
  const baseURL = args.env === 'staging' ? (process.env.STAGING_BASE || 'https://staging.classwaves.local') : 'http://localhost:3000';

  console.log(JSON.stringify({ ok: true, token, claims: payload, baseURL }, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e) }));
  process.exit(1);
});


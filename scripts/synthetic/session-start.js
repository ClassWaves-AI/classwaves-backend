#!/usr/bin/env node
// Hits POST /api/v1/sessions/:id/start (guarded). Expects Bearer token.
// Usage: node scripts/synthetic/session-start.js --env local --sessionId <uuid> --token <jwt>

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { env: 'local' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--env') out.env = args[++i] || 'local';
    else if (a === '--sessionId') out.sessionId = args[++i];
    else if (a === '--token') out.token = args[++i];
  }
  return out;
}

async function main() {
  const { env, sessionId, token } = parseArgs();
  if (!sessionId) throw new Error('Missing --sessionId');
  if (!token) throw new Error('Missing --token');
  const baseURL = env === 'staging' ? (process.env.STAGING_BASE || 'https://staging.classwaves.local') : 'http://localhost:3000';

  const res = await fetch(`${baseURL}/api/v1/sessions/${encodeURIComponent(sessionId)}/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Trace-Id': `synthetic-${Date.now()}`,
    },
    body: JSON.stringify({})
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  console.log(JSON.stringify({ ok: res.ok, status: res.status, url: res.url, json }, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e) }));
  process.exit(1);
});


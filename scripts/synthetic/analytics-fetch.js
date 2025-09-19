#!/usr/bin/env node
// Fetches analytics endpoints
// Usage: node scripts/synthetic/analytics-fetch.js --env local [--sessionId <uuid>] [--token <jwt>]

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

async function call(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, url: res.url, json };
}

async function main() {
  const { env, sessionId, token } = parseArgs();
  const baseURL = env === 'staging' ? (process.env.STAGING_BASE || 'https://staging.classwaves.local') : 'http://localhost:3000';

  const results = [];
  // Public health
  results.push(await call(`${baseURL}/api/v1/analytics/health`, { headers: { 'X-Trace-Id': `synthetic-${Date.now()}` } }));

  // Optional protected fetches
  const headers = { 'Content-Type': 'application/json', 'X-Trace-Id': `synthetic-${Date.now()}` };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  if (sessionId && token) {
    results.push(await call(`${baseURL}/api/v1/analytics/session/${encodeURIComponent(sessionId)}/overview`, { headers }));
  }

  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e) }));
  process.exit(1);
});


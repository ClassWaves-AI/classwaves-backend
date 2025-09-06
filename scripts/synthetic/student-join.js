#!/usr/bin/env node
// Hits POST /api/v1/sessions/join (public student join)
// Usage: node scripts/synthetic/student-join.js --env local --sessionId <uuid> --studentId <id> --name "Student Name"

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { env: 'local' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--env') out.env = args[++i] || 'local';
    else if (a === '--sessionId') out.sessionId = args[++i];
    else if (a === '--studentId') out.studentId = args[++i];
    else if (a === '--name') out.name = args[++i];
  }
  return out;
}

async function main() {
  const { env, sessionId, studentId, name } = parseArgs();
  if (!sessionId) throw new Error('Missing --sessionId');
  if (!studentId) throw new Error('Missing --studentId');
  const baseURL = env === 'staging' ? (process.env.STAGING_BASE || 'https://staging.classwaves.local') : 'http://localhost:3000';

  const res = await fetch(`${baseURL}/api/v1/sessions/join`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Trace-Id': `synthetic-${Date.now()}`,
    },
    body: JSON.stringify({ sessionId, studentId, name: name || 'Student Synthetic' })
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


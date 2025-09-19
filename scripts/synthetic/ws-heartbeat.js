#!/usr/bin/env node
// Connects to Socket.IO namespace and emits a basic heartbeat
// Usage: node scripts/synthetic/ws-heartbeat.js --env local --namespace /sessions

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { env: 'local', namespace: '/sessions' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--env') out.env = args[++i] || 'local';
    else if (a === '--namespace') out.namespace = args[++i];
  }
  return out;
}

async function main() {
  const { env, namespace } = parseArgs();
  const base = env === 'staging' ? (process.env.STAGING_WS || 'https://staging.classwaves.local') : 'http://localhost:3000';

  let io;
  try {
    io = require('socket.io-client');
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: 'socket.io-client not installed' }));
    process.exit(1);
  }

  const url = base + namespace;
  const socket = io.io(url, { transports: ['websocket'], forceNew: true, reconnectionAttempts: 1, timeout: 5000 });

  const timeout = setTimeout(() => {
    console.log(JSON.stringify({ ok: false, event: 'timeout', url }));
    try { socket.close(); } catch {}
    process.exit(1);
  }, 10000);

  socket.on('connect', () => {
    clearTimeout(timeout);
    console.log(JSON.stringify({ ok: true, event: 'connect', id: socket.id, url }));
    socket.emit('heartbeat', { t: Date.now() });
    setTimeout(() => { try { socket.close(); } catch {}; }, 500);
  });
  socket.on('connect_error', (err) => {
    clearTimeout(timeout);
    console.log(JSON.stringify({ ok: false, event: 'connect_error', message: String(err && err.message || err), url }));
    try { socket.close(); } catch {}
    process.exit(1);
  });
  socket.on('disconnect', (reason) => {
    console.log(JSON.stringify({ ok: true, event: 'disconnect', reason, url }));
  });
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e) }));
  process.exit(1);
});


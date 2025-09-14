/*
 * Verification script: REST-first live STT control plane
 * - Boots in-memory Namespaced WS service (no Express app)
 * - Connects a socket-client with a JWT (no schoolId to skip DB school check)
 * - Joins group room server-side, starts audio stream (to start server flush scheduler)
 * - Captures audio:window:flush events (~1s cadence) and then triggers a stall
 * - Observes audio:ingress:stalled and prints metrics summary
 */

import http from 'http';
import { io as ioClient, Socket } from 'socket.io-client';
import * as client from 'prom-client';
import { initializeNamespacedWebSocket, getNamespacedWebSocketService } from '../services/websocket/namespaced-websocket.service';
import { generateAccessToken, generateSessionId } from '../utils/jwt.utils';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.API_DEBUG = process.env.API_DEBUG || '1';
process.env.WS_AUDIO_FLUSH_CADENCE_MS = process.env.WS_AUDIO_FLUSH_CADENCE_MS || '1000';
process.env.WS_STALL_CHECK_INTERVAL_MS = process.env.WS_STALL_CHECK_INTERVAL_MS || '500';
process.env.WS_STALL_NOTIFY_COOLDOWN_MS = process.env.WS_STALL_NOTIFY_COOLDOWN_MS || '2000';

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const server = http.createServer((_, res) => { res.statusCode = 200; res.end('ok'); });
  await new Promise<void>(resolve => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  // Initialize namespaced WS service
  initializeNamespacedWebSocket(server);
  const svc = getNamespacedWebSocketService();
  if (!svc) throw new Error('WS service init failed');

  // Prepare token with no schoolId to bypass school verification in validator
  const sessionId = 'sess-verify-1';
  const teacher = { id: 't-verify-1', email: 'teacher@example.com', name: 'T', role: 'teacher', access_level: 'full' } as any;
  const school = { id: '', name: 'Test', domain: 'test.local', subscription_status: 'active' } as any;
  const token = generateAccessToken(teacher, school, sessionId || generateSessionId());

  const wsUrl = `http://127.0.0.1:${port}/sessions`;
  const sock: Socket = ioClient(wsUrl, { auth: { token }, transports: ['websocket'] });

  const groupId = 'g-verify-1';
  let flushCount = 0;
  let stalledCount = 0;
  const flushEvents: any[] = [];
  const stalledEvents: any[] = [];

  sock.on('connect', async () => {
    console.log('client: connected', { id: sock.id });
    // Join group room from server for this single client
    const ns = svc.getIO().of('/sessions');
    // Wait a tick to ensure socket registered
    await sleep(50);
    await (ns as any).socketsJoin?.(`group:${groupId}`);
    // Start audio stream to trigger scheduler
    sock.emit('audio:stream:start', { groupId });
  });

  sock.on('audio:window:flush', (data) => {
    flushCount += 1;
    flushEvents.push(data);
    console.log('client:event: audio:window:flush', data);
  });
  sock.on('audio:ingress:stalled', (data) => {
    stalledCount += 1;
    stalledEvents.push(data);
    console.warn('client:event: audio:ingress:stalled', data);
  });
  sock.on('audio:stream:start', (d) => console.log('client:event: audio:stream:start', d));
  sock.on('audio:stream:end', (d) => console.log('client:event: audio:stream:end', d));
  sock.on('error', (e) => console.warn('client:error', e));

  // Observe a few flushes
  await sleep(3200);

  // Mark an ingress timestamp via service to enable stall detection (WS path also updates on chunk)
  try {
    (svc.getSessionsService() as any).updateLastIngestAt(sessionId, groupId);
  } catch {}

  // Wait for stall (overdue > 2× cadence)
  await sleep(2600);

  // Cleanup
  sock.emit('audio:stream:end', { groupId });
  await sleep(200);
  sock.disconnect();
  await new Promise<void>(resolve => server.close(() => resolve()));

  // Summarize
  console.log('--- Summary ---');
  console.log('flushCount =', flushCount);
  console.log('stalledCount =', stalledCount);
  try {
    const metrics = await client.register.metrics();
    const lines = metrics.split('\n').filter(l => /audio_window_flush_sent_total|audio_ingress_stalls_total/.test(l));
    console.log(lines.join('\n'));
  } catch {}
}

main().catch((e) => {
  console.error('verify script failed:', e);
  process.exit(1);
});


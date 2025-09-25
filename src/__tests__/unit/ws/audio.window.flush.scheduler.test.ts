import http from 'http'
import { io as clientIO, Socket as ClientSocket } from 'socket.io-client'
import * as client from 'prom-client'
import { initializeNamespacedWebSocket, closeNamespacedWebSocket } from '../../../services/websocket/namespaced-websocket.service'
import { generateAccessToken } from '../../../utils/jwt.utils'

describe('WS: server-driven audio window flush scheduler', () => {
  let server: http.Server
  let port: number
  let socket: ClientSocket

  const sessionId = 'sess-sched-1'
  const groupId = 'g-sched-1'
  const teacher: any = { id: 't-1', email: 't@example.com', role: 'teacher' }
  const school: any = { id: '', name: 'Test' } // empty to bypass school verification
  const token = generateAccessToken(teacher, school, sessionId)

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.JWT_SECRET = 'classwaves-test-secret'
    process.env.API_DEBUG = '1'
    process.env.WS_AUDIO_FLUSH_CADENCE_MS = '150'
    process.env.WS_STALL_CHECK_INTERVAL_MS = '0' // disable stall checker for this test to avoid open handles
    server = http.createServer((_, res) => { res.statusCode = 200; res.end('ok') })
    await new Promise<void>(resolve => server.listen(0, resolve))
    port = (server.address() as any).port
    initializeNamespacedWebSocket(server)
  })

  afterAll(async () => {
    try { await closeNamespacedWebSocket() } catch { /* intentionally ignored: best effort cleanup */ }
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  afterEach(() => {
    try { socket?.disconnect() } catch { /* intentionally ignored: best effort cleanup */ }
    client.register.resetMetrics()
  })

  it('emits periodic audio:window:flush events while stream is active', async () => {
    const url = `http://127.0.0.1:${port}/sessions`
    socket = clientIO(url, { auth: { token }, transports: ['websocket'] })
    await new Promise<void>(r => socket.on('connect', () => r()))

    // Start stream to arm scheduler
    // Ensure the client is in the group room to receive group broadcasts
    const ns = (require('../../../services/websocket/namespaced-websocket.service') as any).getNamespacedWebSocketService().getIO().of('/sessions')
    await Promise.resolve((ns as any).socketsJoin?.(`group:${groupId}`))
    await new Promise(r => setTimeout(r, 30))
    socket.emit('audio:stream:start', { groupId })

    await new Promise(r => setTimeout(r, 1300))

    // End stream to stop scheduler
    socket.emit('audio:stream:end', { groupId })
    await new Promise(r => setTimeout(r, 50))

    // Metric should be registered and incremented
    const m = client.register.getSingleMetric('audio_window_flush_sent_total') as client.Counter<string>
    expect(m).toBeDefined()
    const metricsText = await client.register.metrics()
    expect(metricsText).toMatch(/audio_window_flush_sent_total\{session="sess-sched-1",group="g-sched-1"\}\s+(\d+)/)
  })
})

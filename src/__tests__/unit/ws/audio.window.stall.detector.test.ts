import http from 'http'
import { io as clientIO, Socket as ClientSocket } from 'socket.io-client'
import * as client from 'prom-client'
import { initializeNamespacedWebSocket, getNamespacedWebSocketService, closeNamespacedWebSocket } from '../../../services/websocket/namespaced-websocket.service'
import { generateAccessToken } from '../../../utils/jwt.utils'

jest.mock('../../../services/websocket/websocket-security-validator.service', () => ({
  webSocketSecurityValidator: {
    validateNamespaceAccess: jest.fn().mockResolvedValue({ allowed: true }),
    logSecurityEvent: jest.fn().mockResolvedValue(undefined),
    handleDisconnection: jest.fn().mockResolvedValue(undefined),
    getNamespaceConfig: jest.fn().mockReturnValue({
      allowedRoles: ['teacher', 'admin', 'super_admin', 'student'],
      requireSchoolVerification: false,
      requireSessionAccess: false,
      maxConnectionsPerUser: 50,
      rateLimitWindow: 60,
      rateLimitMaxRequests: 100,
    }),
  },
}));

jest.mock('../../../services/databricks.service', () => ({
  databricksService: {
    queryOne: jest.fn().mockResolvedValue({ id: 'session', teacher_id: 't-1', school_id: 'school-1' }),
    query: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../../../utils/audit.port.instance', () => ({
  auditLogPort: {
    enqueue: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('WS: stall detector emits audio:ingress:stalled after overdue', () => {
  let server: http.Server
  let port: number
  let socket: ClientSocket
  let setImmediateSpy: jest.SpyInstance<any, any>

  const sessionId = 'sess-stall-1'
  const groupId = 'g-stall-1'
  const teacher: any = { id: 't-1', email: 't@example.com', role: 'teacher' }
  const school: any = { id: '', name: 'Test' }
  const token = generateAccessToken(teacher, school, sessionId)

  beforeAll(async () => {
    setImmediateSpy = jest.spyOn(global, 'setImmediate').mockImplementation(((cb: (...args: any[]) => void, ...args: any[]) => {
      cb(...args)
      return 0 as any
    }) as any)
    process.env.NODE_ENV = 'test'
    process.env.JWT_SECRET = 'classwaves-test-secret'
    process.env.API_DEBUG = '1'
    process.env.WS_AUDIO_FLUSH_CADENCE_MS = '150'
    process.env.WS_STALL_CHECK_INTERVAL_MS = '60'
    process.env.WS_STALL_NOTIFY_COOLDOWN_MS = '200'
    server = http.createServer((_, res) => { res.statusCode = 200; res.end('ok') })
    await new Promise<void>(resolve => server.listen(0, resolve))
    port = (server.address() as any).port
    initializeNamespacedWebSocket(server)
  })

  afterAll(async () => {
    try { await closeNamespacedWebSocket() } catch { /* intentionally ignored: best effort cleanup */ }
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>(resolve => server.close(() => resolve()))
    setImmediateSpy.mockRestore()
  })

  afterEach(() => {
    try { socket?.disconnect() } catch { /* intentionally ignored: best effort cleanup */ }
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
  })

  it('emits audio:ingress:stalled when no ingest observed for > 2× cadence', async () => {
    const url = `http://127.0.0.1:${port}/sessions`
    socket = clientIO(url, { auth: { token }, transports: ['websocket'] })
    await new Promise<void>(r => socket.on('connect', () => r()))

    const stalled: any[] = []
    socket.on('audio:ingress:stalled', (d) => stalled.push(d))

    // Join a group room and start stream to arm scheduler
    const ns = (require('../../../services/websocket/namespaced-websocket.service') as any).getNamespacedWebSocketService().getIO().of('/sessions')
    await Promise.resolve((ns as any).socketsJoin?.(`group:${groupId}`))
    socket.emit('audio:stream:start', { groupId })
    await new Promise(r => setTimeout(r, 450))

    // Simulate one ingest, then let it lapse
    const svc = getNamespacedWebSocketService()!
    ;(svc.getSessionsService() as any).updateLastIngestAt(sessionId, groupId)

    // Wait beyond 2× cadence (≈300ms) and stall sweep interval; allow 500–700ms
    await new Promise(r => setTimeout(r, 700))

    // End stream and disconnect
    socket.emit('audio:stream:end', { groupId })
    await new Promise(r => setTimeout(r, 30))

    expect(stalled.length).toBeGreaterThanOrEqual(1)
    const m = client.register.getSingleMetric('audio_ingress_stalls_total') as client.Counter<string>
    expect(m).toBeDefined()
  })
  
  afterEach(async () => {
    // Clear stall interval to avoid open handle
    try {
      const ns = getNamespacedWebSocketService()!
      const svc: any = ns.getSessionsService()
      if (svc?.stallCheckTimer) {
        clearInterval(svc.stallCheckTimer)
        svc.stallCheckTimer = null
      }
    } catch { /* intentionally ignored: best effort cleanup */ }
  })
})

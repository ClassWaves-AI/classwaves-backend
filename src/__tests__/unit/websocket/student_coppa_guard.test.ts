import { SessionsNamespaceService } from '../../../services/websocket/sessions-namespace.service'

const createMockNamespace = () => ({
  use: jest.fn(),
  on: jest.fn(),
  to: jest.fn().mockReturnValue({ emit: jest.fn() }),
  emit: jest.fn(),
  adapter: { rooms: new Map() },
  sockets: new Map(),
});

const createMockSocket = (data: any = {}) => ({
  id: 'sock-1',
  data: { userId: 'stu-1', role: 'student', schoolId: 'sch-1', ...data },
  on: jest.fn(),
  emit: jest.fn(),
  join: jest.fn(),
  leave: jest.fn(),
  to: jest.fn().mockReturnValue({ emit: jest.fn() }),
}) as any

jest.mock('../../../services/databricks.service', () => ({
  databricksService: {
    queryOne: jest.fn(),
  },
}))

describe('WS student join COPPA guard', () => {
  it('rejects student join when consent not present', async () => {
    const ns = createMockNamespace()
    const service = new SessionsNamespaceService(ns as any)
    const socket: any = createMockSocket({ role: 'student' })
    socket.join = jest.fn()
    socket.emit = jest.fn()

    const db = require('../../../services/databricks.service')
    // First queryOne: participant; second: student record
    db.databricksService.queryOne
      .mockResolvedValueOnce({ id: 'p1', session_id: 's1', student_id: 'stu1', group_id: null, group_name: null })
      .mockResolvedValueOnce({ id: 'stu1', coppa_compliant: false, has_parental_consent: false })

    await (service as any).handleStudentSessionJoin(socket, { sessionId: 's1' })

    // Should have emitted consent-required error, not joined any group
    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ code: 'COPPA_CONSENT_REQUIRED' }))
    // Should not call join for group since blocked
    const calledWith = (socket.join as jest.Mock).mock.calls.map((c) => c[0])
    // Session join may happen early; but no further group join expected
    expect(calledWith).not.toContain('group:')
  })
})

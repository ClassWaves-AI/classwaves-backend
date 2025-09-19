import request from 'supertest'
import { createTestApp } from '../../test-utils/app-setup'
import { databricksService } from '../../../services/databricks.service'

describe('Integration: Analytics endpoints use explicit SQL projections', () => {
  let app: any
  const collectedSql: string[] = []

  beforeAll(async () => {
    const setup = await createTestApp()
    app = setup.app
  })

  beforeEach(() => {
    collectedSql.length = 0
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  function setupQuerySpies() {
    jest.spyOn(databricksService, 'query').mockImplementation(async (sql: string) => {
      collectedSql.push(sql)
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
      if (normalized.includes('select 1 as test_value')) {
        return [{ test_value: 1 }] as any
      }
      if (normalized.includes('count(*) as record_count')) {
        return [{ record_count: 0 }] as any
      }
      if (normalized.includes('from classwaves.sessions.classroom_sessions where id = ?')) {
        // verifySessionOwnership: return owned by test teacher
        return [{ teacher_id: 'test-teacher-123', topic: 'T', scheduled_start: null, actual_end: null, status: 'created' }] as any
      }
      // Generic fallback
      return [] as any
    })

    jest.spyOn(databricksService, 'queryOne').mockImplementation(async (sql: string) => {
      collectedSql.push(sql)
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
      if (normalized.includes('select 1 as test_connection') || normalized.includes('select 1 from')) {
        return { ok: 1 } as any
      }
      if (normalized.includes('count(*) as')) {
        return { count: 0 } as any
      }
      // Default: no single row
      return null as any
    })
  }

  function assertNoStarSelects() {
    const offending = collectedSql.filter(s => /select\s+\*/i.test(s) || /\b[a-z]\s*\.\s*\*/i.test(s))
    if (offending.length > 0) {
      // Helpful debug output
      // eslint-disable-next-line no-console
      console.error('Offending SQL with star selects:', offending)
    }
    expect(offending).toHaveLength(0)
  }

  it('GET /api/v1/analytics/teacher uses explicit fields (no star selects)', async () => {
    setupQuerySpies()
    const res = await request(app)
      .get('/api/v1/analytics/teacher?timeframe=weekly&includeComparisons=false')
      .set('Authorization', 'Bearer test-auth-token')
      .expect(200)
    expect(res.body).toBeDefined()
    expect(collectedSql.length).toBeGreaterThan(0)
    assertNoStarSelects()
  })

  it('GET /api/v1/analytics/session/:id uses explicit fields (no star selects)', async () => {
    setupQuerySpies()
    const sessionId = '00000000-0000-0000-0000-000000000001'
    const res = await request(app)
      .get(`/api/v1/analytics/session/${sessionId}?includeGroupBreakdown=true&includeRealtimeMetrics=false`)
      .set('Authorization', 'Bearer test-auth-token')
      .expect(200)
    expect(res.body).toBeDefined()
    expect(collectedSql.length).toBeGreaterThan(0)
    assertNoStarSelects()
    // Ensure cache read targets canonical users schema
    expect(collectedSql.join('\n')).toMatch(/FROM\s+classwaves\.users\.session_analytics_cache/i)
    // Ensure participation_rate is selected (users schema), not avg_participation_rate
    const sqlBlob = collectedSql.join('\n').toLowerCase()
    expect(sqlBlob).toContain('participation_rate')
    expect(sqlBlob).not.toContain('avg_participation_rate')
  })
})

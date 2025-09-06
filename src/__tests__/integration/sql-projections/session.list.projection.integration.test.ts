import request from 'supertest'
import { createTestApp } from '../../test-utils/app-setup'
import { databricksService } from '../../../services/databricks.service'

describe('Integration: Session list minimal SQL projection', () => {
  let app: any

  beforeAll(async () => {
    const setup = await createTestApp()
    app = setup.app
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('GET /api/v1/sessions issues explicit field select (no star)', async () => {
    const spy = jest.spyOn(databricksService, 'query').mockResolvedValue([] as any)

    const res = await request(app)
      .get('/api/v1/sessions?limit=3')
      .set('Authorization', 'Bearer test-auth-token')
      .expect(200)

    expect(res.body).toBeDefined()
    expect(spy).toHaveBeenCalled()

    const sql = (spy.mock.calls[0]?.[0] || '') as string
    // Asserts minimal session fields via query builder usage
    expect(sql).toMatch(/SELECT\s+s\.id,\s*s\.title,\s*s\.description,\s*s\.status,\s*s\.teacher_id,\s*s\.school_id,\s*s\.target_group_size,\s*s\.scheduled_start,\s*s\.actual_start,\s*s\.planned_duration_minutes,\s*s\.created_at/)
    expect(sql).toContain('g.group_count')
    expect(sql).toContain('g.student_count')
    expect(sql).not.toMatch(/SELECT\s+\*/i)
    expect(sql).not.toMatch(/\bs\.\*/)
  })
})


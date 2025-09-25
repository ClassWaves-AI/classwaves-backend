import { databricksService, getDatabricksService, resetDatabricksServiceForTests } from '../../../services/databricks.service'

describe('SQL Projections: DatabricksService minimal field selection', () => {
  beforeAll(async () => {
    process.env.DATABRICKS_MOCK = '0'
    await resetDatabricksServiceForTests()
  })

  afterAll(async () => {
    delete process.env.DATABRICKS_MOCK
    await resetDatabricksServiceForTests()
  })

  beforeEach(async () => {
    jest.restoreAllMocks()
    process.env.DATABRICKS_MOCK = '0'
    await resetDatabricksServiceForTests()
  })

  it('getTeacherByEmail selects explicit teacher fields (no t.* or SELECT *)', async () => {
    const svc = getDatabricksService() as any
    const spy = jest.spyOn(svc, 'queryOne').mockResolvedValue(null as any)
    await databricksService.getTeacherByEmail('teacher@example.com')
    expect(spy).toHaveBeenCalled()
    const sql = (spy.mock.calls[0]?.[0] || '') as string
    expect(sql).toMatch(/SELECT\s+\s*t\.id,\s*t\.google_id,\s*t\.email,\s*t\.name/)
    expect(sql).toContain('s.name as school_name')
    expect(sql).not.toMatch(/SELECT\s+\*/i)
    expect(sql).not.toMatch(/\bt\.\*/)
  })

  it('getTeacherByGoogleId selects explicit teacher fields (no t.* or SELECT *)', async () => {
    const svc = getDatabricksService() as any
    const spy = jest.spyOn(svc, 'queryOne').mockResolvedValue(null as any)
    await databricksService.getTeacherByGoogleId('google-123')
    expect(spy).toHaveBeenCalled()
    const sql = (spy.mock.calls[0]?.[0] || '') as string
    expect(sql).toMatch(/SELECT\s+\s*t\.id,\s*t\.google_id,\s*t\.email,\s*t\.name/)
    expect(sql).toContain('s.domain as school_domain')
    expect(sql).not.toMatch(/SELECT\s+\*/i)
    expect(sql).not.toMatch(/\bt\.\*/)
  })

  it('getSchoolByDomain selects explicit school fields (no SELECT *)', async () => {
    const svc = getDatabricksService() as any
    const spy = jest.spyOn(svc, 'queryOne').mockResolvedValue(null as any)
    await databricksService.getSchoolByDomain('demo.classwaves.com')
    expect(spy).toHaveBeenCalled()
    const sql = (spy.mock.calls[0]?.[0] || '') as string
    expect(sql).toMatch(/SELECT\s+\s*id,\s*name,\s*domain,\s*admin_email/)
    expect(sql).toContain('subscription_status')
    expect(sql).not.toMatch(/SELECT\s+\*/i)
  })

  it('batchAuthOperations CTEs select explicit fields (no s.* / t.*)', async () => {
    const svc = getDatabricksService() as any
    const spyQ = jest.spyOn(svc, 'query').mockResolvedValue([
      {
        type: 'school',
        school_id: 'school-1',
        school_name: 'Demo High',
        school_domain: 'demo.classwaves.com',
        subscription_tier: 'basic',
        subscription_status: 'trial',
        teacher_count: 10,
        student_count: 250,
      },
      {
        type: 'teacher',
        teacher_id: 'teacher-1',
        teacher_role: 'teacher',
        teacher_access_level: 'basic',
        teacher_login_count: 3,
      },
    ])
    jest.spyOn(svc, 'update').mockResolvedValue(true as any)

    await (await import('../../../services/databricks.service')).databricksService.batchAuthOperations(
      { id: 'google-123' },
      'demo.classwaves.com'
    )
    expect(spyQ).toHaveBeenCalled()
    const sql = (spyQ.mock.calls[0]?.[0] || '') as string
    expect(sql).toMatch(/WITH\s+school_lookup\s+AS\s*\(/)
    expect(sql).toMatch(/SELECT\s+s\.id,\s*s\.name,\s*s\.domain,\s*s\.subscription_tier/)
    expect(sql).toMatch(/teacher_lookup\s+AS\s*\(/)
    expect(sql).toMatch(/SELECT\s+t\.school_id,\s*t\.id,\s*t\.email,\s*t\.name,\s*t\.role/)
    expect(sql).not.toMatch(/\bs\.\*/)
    expect(sql).not.toMatch(/\bt\.\*/)
  })
})

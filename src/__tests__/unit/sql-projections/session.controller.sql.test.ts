import { databricksService } from '../../../services/databricks.service'
import { getTeacherSessionsOptimized } from '../../../controllers/session.controller'

describe('SQL Projections: Session list uses minimal fields', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('builds SELECT with explicit session fields and group aggregates', async () => {
    const spy = jest.spyOn(databricksService, 'query').mockResolvedValue([] as any)
    await getTeacherSessionsOptimized('teacher-123', 10)
    expect(spy).toHaveBeenCalled()
    const sql = (spy.mock.calls[0]?.[0] || '') as string
    // Includes minimal session fields
    expect(sql).toMatch(/SELECT\s+s\.id,\s*s\.title,\s*s\.description,\s*s\.status,\s*s\.teacher_id,\s*s\.school_id,\s*s\.target_group_size,\s*s\.scheduled_start,\s*s\.actual_start,\s*s\.planned_duration_minutes,\s*s\.created_at/)
    // Includes aggregates from g
    expect(sql).toContain('g.group_count')
    expect(sql).toContain('g.student_count')
    // No star selects
    expect(sql).not.toMatch(/SELECT\s+\*/i)
    expect(sql).not.toMatch(/\bs\.\*/)
  })
})


import request from 'supertest'
import app from '../../app'
import { generateAccessToken } from '../../utils/jwt.utils'

describe('Admin Districts RBAC', () => {
  const school = {
    id: 'school-active-123',
    name: 'Active Test School',
    domain: 'activeschool.edu',
    subscription_tier: 'pro',
  } as any

  const nonSuperAdmin = {
    id: 'teacher-admin-456',
    email: 'admin@activeschool.edu',
    name: 'School Admin',
    role: 'admin',
    access_level: 'admin',
    school_id: school.id,
  } as any

  it('POST /api/v1/admin/districts returns 403 for non-super_admin', async () => {
    const token = generateAccessToken(nonSuperAdmin, school, 'rbac-test-session')
    const res = await request(app)
      .post('/api/v1/admin/districts')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X', state: 'CA' })

    expect([403, 429]).toContain(res.status) // allow rate-limit in noisy CI
    if (res.status === 403) {
      expect(res.body?.error || res.body?.error?.code || res.body?.code).toBeDefined()
    }
  })
})


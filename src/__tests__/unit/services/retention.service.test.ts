import { computeDeletionDate, getDefaultRetentionDays } from '../../../services/retention.service'

describe('RetentionService', () => {
  it('computes deletion date correctly for a given number of days', () => {
    const base = new Date('2025-01-01T00:00:00.000Z')
    const del = computeDeletionDate(base, 30)
    expect(del.toISOString()).toBe('2025-01-31T00:00:00.000Z')
  })

  it('uses default retention days from env when valid', () => {
    const prev = process.env.RETENTION_DEFAULT_DAYS
    process.env.RETENTION_DEFAULT_DAYS = '10'
    expect(getDefaultRetentionDays()).toBe(10)
    process.env.RETENTION_DEFAULT_DAYS = prev
  })

  it('falls back to 2555 days when env is invalid', () => {
    const prev = process.env.RETENTION_DEFAULT_DAYS
    process.env.RETENTION_DEFAULT_DAYS = 'not-a-number'
    expect(getDefaultRetentionDays()).toBe(2555)
    process.env.RETENTION_DEFAULT_DAYS = prev
  })
})


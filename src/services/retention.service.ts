export function getDefaultRetentionDays(): number {
  const val = parseInt(process.env.RETENTION_DEFAULT_DAYS || '2555', 10); // ~7 years
  return Number.isFinite(val) && val > 0 ? val : 2555;
}

export function computeDeletionDate(createdAt: Date | string, days: number): Date {
  const created = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;
  const ms = days * 24 * 60 * 60 * 1000;
  return new Date(created.getTime() + ms);
}

export function computeDeletionDateDefault(createdAt: Date | string): Date {
  return computeDeletionDate(createdAt, getDefaultRetentionDays());
}


export interface BudgetConfig {
  daily_minutes_limit: number;
  alert_thresholds: string; // JSON string in table
}

export interface BudgetRepositoryPort {
  getBudgetConfig(schoolId: string): Promise<BudgetConfig | null>;
  upsertBudgetConfig(schoolId: string, dailyMinutesLimit: number, alertThresholds: number[]): Promise<void>;
}


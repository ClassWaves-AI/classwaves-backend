import { databricksService } from '../../services/databricks.service';
import { databricksConfig } from '../../config/databricks.config';
import type { BudgetRepositoryPort, BudgetConfig } from '../../services/ports/budget.repository.port';

export class DatabricksBudgetRepository implements BudgetRepositoryPort {
  async getBudgetConfig(schoolId: string): Promise<BudgetConfig | null> {
    const sql = `
      SELECT daily_minutes_limit, alert_thresholds
      FROM ${databricksConfig.catalog}.schools.budget_config 
      WHERE school_id = ?
    `;
    const row = await databricksService.queryOne(sql, [schoolId]);
    return (row as any) || null;
  }

  async upsertBudgetConfig(schoolId: string, dailyMinutesLimit: number, alertThresholds: number[]): Promise<void> {
    const sql = `
      MERGE INTO ${databricksConfig.catalog}.schools.budget_config AS target
      USING (SELECT ? as school_id, ? as daily_minutes_limit, ? as alert_thresholds) AS source
      ON target.school_id = source.school_id
      WHEN MATCHED THEN
        UPDATE SET 
          daily_minutes_limit = source.daily_minutes_limit,
          alert_thresholds = source.alert_thresholds,
          updated_at = current_timestamp()
      WHEN NOT MATCHED THEN
        INSERT (school_id, daily_minutes_limit, alert_thresholds, created_at, updated_at)
        VALUES (source.school_id, source.daily_minutes_limit, source.alert_thresholds, current_timestamp(), current_timestamp())
    `;
    await databricksService.query(sql, [schoolId, dailyMinutesLimit, JSON.stringify(alertThresholds)]);
  }
}

export const budgetRepository: BudgetRepositoryPort = new DatabricksBudgetRepository();


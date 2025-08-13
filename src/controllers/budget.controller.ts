import { Request, Response } from 'express';
import { openAIWhisperService } from '../services/openai-whisper.service';
import { databricksService } from '../services/databricks.service';

export interface BudgetUsageResponse {
  schoolId: string;
  date: string;
  minutesUsed: number;
  minutesLimit: number;
  percentUsed: number;
  status: 'ok' | 'warning' | 'critical' | 'exceeded';
  lastUpdated: string;
}

export interface BudgetAlertResponse {
  schoolId: string;
  alerts: Array<{
    id: string;
    percentage: number;
    triggeredAt: string;
    status: 'active' | 'acknowledged';
  }>;
}

/**
 * Get current budget usage for a school
 * GET /api/v1/schools/:schoolId/budget/usage
 */
export const getBudgetUsage = async (req: Request, res: Response): Promise<void> => {
  try {
    const { schoolId } = req.params;
    const { date } = req.query;
    
    if (!schoolId) {
      res.status(400).json({ error: 'School ID is required' });
      return;
    }

    // Default to today if no date provided
    const queryDate = date as string || new Date().toISOString().split('T')[0];
    
    // Get budget usage from OpenAI Whisper service
    const usage = await openAIWhisperService.getBudgetUsage(schoolId, queryDate);
    
    // Get school budget limit from database
    const schoolConfig = await getSchoolBudgetConfig(schoolId);
    const minutesLimit = schoolConfig?.dailyMinutesLimit || 120; // Default 2 hours per day
    
    const percentUsed = Math.round((usage.minutes / minutesLimit) * 100);
    
    let status: 'ok' | 'warning' | 'critical' | 'exceeded' = 'ok';
    if (percentUsed >= 100) status = 'exceeded';
    else if (percentUsed >= 90) status = 'critical';
    else if (percentUsed >= 75) status = 'warning';
    
    const response: BudgetUsageResponse = {
      schoolId,
      date: queryDate,
      minutesUsed: usage.minutes,
      minutesLimit,
      percentUsed,
      status,
      lastUpdated: new Date().toISOString()
    };
    
    res.json(response);
  } catch (error) {
    console.error('Error fetching budget usage:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get budget alerts for a school
 * GET /api/v1/schools/:schoolId/budget/alerts
 */
export const getBudgetAlerts = async (req: Request, res: Response): Promise<void> => {
  try {
    const { schoolId } = req.params;
    
    if (!schoolId) {
      res.status(400).json({ error: 'School ID is required' });
      return;
    }

    // Get active budget alerts from OpenAI Whisper service
    const alerts = await openAIWhisperService.getBudgetAlerts(schoolId);
    
    const response: BudgetAlertResponse = {
      schoolId,
      alerts: alerts.map(alert => ({
        id: alert.id,
        percentage: alert.percentage,
        triggeredAt: alert.triggeredAt,
        status: alert.acknowledged ? 'acknowledged' : 'active'
      }))
    };
    
    res.json(response);
  } catch (error) {
    console.error('Error fetching budget alerts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Update school budget configuration
 * PUT /api/v1/schools/:schoolId/budget/config
 */
export const updateBudgetConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const { schoolId } = req.params;
    const { dailyMinutesLimit, alertThresholds } = req.body;
    
    if (!schoolId) {
      res.status(400).json({ error: 'School ID is required' });
      return;
    }

    if (!dailyMinutesLimit || dailyMinutesLimit <= 0) {
      res.status(400).json({ error: 'Valid dailyMinutesLimit is required' });
      return;
    }

    // Validate alert thresholds
    const validThresholds = alertThresholds?.filter((t: number) => t > 0 && t <= 100) || [75, 90];
    
    // Update school budget configuration
    await updateSchoolBudgetConfig(schoolId, {
      dailyMinutesLimit,
      alertThresholds: validThresholds
    });
    
    res.json({ 
      success: true, 
      schoolId,
      config: {
        dailyMinutesLimit,
        alertThresholds: validThresholds
      }
    });
  } catch (error) {
    console.error('Error updating budget config:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Acknowledge a budget alert
 * POST /api/v1/schools/:schoolId/budget/alerts/:alertId/acknowledge
 */
export const acknowledgeBudgetAlert = async (req: Request, res: Response): Promise<void> => {
  try {
    const { schoolId, alertId } = req.params;
    
    if (!schoolId || !alertId) {
      res.status(400).json({ error: 'School ID and Alert ID are required' });
      return;
    }

    await openAIWhisperService.acknowledgeBudgetAlert(schoolId, alertId);
    
    res.json({ success: true, schoolId, alertId });
  } catch (error) {
    console.error('Error acknowledging budget alert:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Helper functions for database operations
async function getSchoolBudgetConfig(schoolId: string) {
  try {
    const query = `
      SELECT daily_minutes_limit, alert_thresholds
      FROM schools.budget_config 
      WHERE school_id = ?
    `;
    const result = await databricksService.query(query, [schoolId]);
    return result?.[0] || null;
  } catch (error) {
    console.warn('Error fetching school budget config:', error);
    return null;
  }
}

async function updateSchoolBudgetConfig(schoolId: string, config: { dailyMinutesLimit: number; alertThresholds: number[] }) {
  const query = `
    MERGE INTO schools.budget_config AS target
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
  
  await databricksService.query(query, [
    schoolId, 
    config.dailyMinutesLimit, 
    JSON.stringify(config.alertThresholds)
  ]);
}

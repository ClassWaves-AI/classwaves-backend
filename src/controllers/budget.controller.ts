import { Request, Response } from 'express';
import { sttBudgetService } from '../services/stt.budget.service';
import { getCompositionRoot } from '../app/composition-root';
import { logger } from '../utils/logger';

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
    const usage = await sttBudgetService.getUsage(schoolId, queryDate);
    
    // Get school budget limit from database
    const budgetRepo = getCompositionRoot().getBudgetRepository();
    const schoolConfig = await budgetRepo.getBudgetConfig(schoolId);
    const minutesLimit = schoolConfig?.daily_minutes_limit || 120; // Default 2 hours per day
    
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
    logger.error('Error fetching budget usage:', error);
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
    const alerts = await sttBudgetService.getAlerts(schoolId);
    
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
    logger.error('Error fetching budget alerts:', error);
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
    const budgetRepo = getCompositionRoot().getBudgetRepository();
    await budgetRepo.upsertBudgetConfig(schoolId, dailyMinutesLimit, validThresholds);
    
    res.json({ 
      success: true, 
      schoolId,
      config: {
        dailyMinutesLimit,
        alertThresholds: validThresholds
      }
    });
  } catch (error) {
    logger.error('Error updating budget config:', error);
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

    await sttBudgetService.acknowledgeAlert(schoolId, alertId);
    
    res.json({ success: true, schoolId, alertId });
  } catch (error) {
    logger.error('Error acknowledging budget alert:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

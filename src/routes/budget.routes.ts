import { Router } from 'express';
import {
  getBudgetUsage,
  getBudgetAlerts,
  updateBudgetConfig,
  acknowledgeBudgetAlert
} from '../controllers/budget.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validateSchoolAccess } from '../middleware/school.middleware';

const router = Router();

// All budget routes require authentication
router.use(authenticate);

/**
 * @route GET /api/v1/schools/:schoolId/budget/usage
 * @desc Get current budget usage for a school
 * @access Private (Authenticated teachers/admins for the school)
 */
router.get('/:schoolId/budget/usage', validateSchoolAccess, getBudgetUsage);

/**
 * @route GET /api/v1/schools/:schoolId/budget/alerts
 * @desc Get budget alerts for a school
 * @access Private (Authenticated teachers/admins for the school)
 */
router.get('/:schoolId/budget/alerts', validateSchoolAccess, getBudgetAlerts);

/**
 * @route PUT /api/v1/schools/:schoolId/budget/config
 * @desc Update school budget configuration
 * @access Private (School admins only)
 */
router.put('/:schoolId/budget/config', validateSchoolAccess, updateBudgetConfig);

/**
 * @route POST /api/v1/schools/:schoolId/budget/alerts/:alertId/acknowledge
 * @desc Acknowledge a budget alert
 * @access Private (Authenticated teachers/admins for the school)
 */
router.post('/:schoolId/budget/alerts/:alertId/acknowledge', validateSchoolAccess, acknowledgeBudgetAlert);

export default router;

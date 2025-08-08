import { Router } from 'express';
import { updateGroupStatus } from '../controllers/kiosk.controller';
import { authenticateKiosk } from '../middleware/kiosk.auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { updateGroupStatusSchema } from '../utils/validation.schemas';

const router = Router();

// This endpoint is used by the student-facing "kiosk" app to report its status.
// It is authenticated using a special, single-purpose JWT (group_access_token).
router.post(
  '/groups/:groupId/status',
  authenticateKiosk,
  validate(updateGroupStatusSchema),
  updateGroupStatus
);

export default router;


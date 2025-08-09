import { Router } from 'express';
import {
  getSessionGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  assignGroupLeader,
  autoGenerateGroups,
} from '../controllers/group.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { 
  createGroupSchema,
  updateGroupSchema,
  assignGroupLeaderSchema 
} from '../utils/validation.schemas';

const router = Router({ mergeParams: true }); // mergeParams to access sessionId from parent route

// All routes require authentication
router.use(authenticate);

// Group operations (nested under /sessions/:sessionId/groups)
router.get('/', getSessionGroups);
router.post('/', validate(createGroupSchema), createGroup);
router.put('/:groupId', validate(updateGroupSchema), updateGroup);
router.delete('/:groupId', deleteGroup);
router.post('/auto-generate', autoGenerateGroups);

// Group leader management
router.post('/:groupId/assign-leader', validate(assignGroupLeaderSchema), assignGroupLeader);

export default router;
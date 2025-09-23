import { Router } from 'express';
import {
  listSchools,
  createSchool,
  updateSchool,
  listTeachers,
  updateTeacher,
  getPromptDeliverySLI,
  verifyInvite,
  acceptInvite,
  inviteTeacher,
  listDistricts,
  getDistrictByIdHandler,
  createDistrict,
  updateDistrict,
} from '../controllers/admin.controller';
import { authenticate, requireRole, requireSuperAdmin } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import {
  createSchoolSchema,
  updateSchoolSchema,
  updateTeacherSchema,
  inviteTeacherSchema,
} from '../utils/validation.schemas';
import { createUserRateLimiter } from '../middleware/rate-limit.middleware';
import { markStudentThirteenPlus } from '../controllers/admin.controller';

const router = Router();

// Public invite verification/acceptance (no authentication), but rate-limited
router.get('/invites/:token/verify', createUserRateLimiter('invite-verify', 10, 60), verifyInvite);
router.post('/invites/accept', createUserRateLimiter('invite-accept', 5, 60), validate(require('../utils/validation.schemas').acceptInviteSchema), acceptInvite);

// All other admin routes require authentication
router.use(authenticate);

// School management endpoints (super_admin only)
router.get('/schools', requireRole(['super_admin']), listSchools);
router.post('/schools', requireRole(['super_admin']), validate(createSchoolSchema), createSchool);
router.put('/schools/:id', requireRole(['super_admin']), validate(updateSchoolSchema), updateSchool);

// Teacher management endpoints
router.get('/teachers', requireRole(['admin', 'super_admin']), listTeachers);
router.put('/teachers/:id', requireRole(['admin', 'super_admin']), validate(updateTeacherSchema), updateTeacher);
router.post(
  '/teachers/invite',
  requireRole(['admin', 'super_admin']),
  createUserRateLimiter('admin-invite', 5, 3600),
  validate(inviteTeacherSchema),
  inviteTeacher
);

// Observability SLIs (prompt delivery) — super_admin only
router.get('/slis/prompt-delivery', requireRole(['super_admin']), getPromptDeliverySLI);

// Roster maintenance helpers (admin/super_admin)
router.post('/students/mark-13plus', requireRole(['admin', 'super_admin']), createUserRateLimiter('mark-13plus', 5, 60), markStudentThirteenPlus);

// Districts (super_admin only)
router.get('/districts', requireSuperAdmin(), listDistricts);
router.get('/districts/:id', requireSuperAdmin(), getDistrictByIdHandler);
router.post('/districts', requireSuperAdmin(), createUserRateLimiter('admin-districts', 3, 60), validate(require('../utils/validation.schemas').createDistrictSchema), createDistrict);
router.put('/districts/:id', requireSuperAdmin(), createUserRateLimiter('admin-districts', 3, 60), validate(require('../utils/validation.schemas').updateDistrictSchema), updateDistrict);

export default router;

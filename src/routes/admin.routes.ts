import { Router } from 'express';
import { 
  listSchools,
  createSchool,
  updateSchool,
  listTeachers,
  updateTeacher,
  getPromptDeliverySLI
} from '../controllers/admin.controller';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { 
  createSchoolSchema,
  updateSchoolSchema,
  updateTeacherSchema 
} from '../utils/validation.schemas';

const router = Router();

// All admin routes require authentication
router.use(authenticate);

// Super admin only routes
router.use(requireRole(['super_admin']));

// School management endpoints
router.get('/schools', listSchools);
router.post('/schools', validate(createSchoolSchema), createSchool);
router.put('/schools/:id', validate(updateSchoolSchema), updateSchool);

// Teacher management endpoints (school-specific)
router.get('/teachers', listTeachers);
router.put('/teachers/:id', validate(updateTeacherSchema), updateTeacher);

// Observability SLIs (prompt delivery) — super_admin only
router.get('/slis/prompt-delivery', getPromptDeliverySLI);

export default router;

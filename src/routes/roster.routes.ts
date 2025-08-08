import { Router } from 'express';
import { 
  listStudents,
  createStudent,
  updateStudent,
  deleteStudent,
  ageVerifyStudent,
  requestParentalConsent
} from '../controllers/roster.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { 
  createStudentSchema,
  updateStudentSchema,
  ageVerificationSchema 
} from '../utils/validation.schemas';

const router = Router();

// All roster routes require authentication
router.use(authenticate);

// Student roster management
router.get('/', listStudents);
router.post('/', validate(createStudentSchema), createStudent);
router.put('/:id', validate(updateStudentSchema), updateStudent);
router.delete('/:id', deleteStudent);

// COPPA compliance endpoints
router.post('/:id/age-verify', validate(ageVerificationSchema), ageVerifyStudent);
router.post('/:id/parental-consent', requestParentalConsent);

export default router;

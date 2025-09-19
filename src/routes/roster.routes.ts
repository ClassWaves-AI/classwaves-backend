import { Router } from 'express';
import { 
  listStudents,
  createStudent,
  updateStudent,
  deleteStudent,
  ageVerifyStudent,
  requestParentalConsent,
  getRosterOverview
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
router.get('/students', listStudents);
router.post('/students', validate(createStudentSchema), createStudent);
router.put('/students/:id', validate(updateStudentSchema), updateStudent);
router.delete('/students/:id', deleteStudent);

// COPPA compliance endpoints
router.post('/students/:id/age-verify', validate(ageVerificationSchema), ageVerifyStudent);
router.post('/students/:id/parental-consent', requestParentalConsent);

// Roster overview endpoint
router.get('/overview', getRosterOverview);

// Export endpoint  
router.get('/export', async (req, res) => {
  // TODO: Implement roster export
  res.json({ success: true, message: 'Export functionality coming soon' });
});

// Import endpoint
router.post('/import', async (req, res) => {
  // TODO: Implement roster import
  res.json({ success: true, message: 'Import functionality coming soon' });
});

export default router;

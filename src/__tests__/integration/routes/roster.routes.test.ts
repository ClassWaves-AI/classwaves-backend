import request from 'supertest';
import express from 'express';
import rosterRoutes from '../../../routes/roster.routes';
import { authenticate } from '../../../middleware/auth.middleware';
import { errorHandler } from '../../../middleware/error.middleware';
import { mockDatabricksService } from '../../mocks/databricks.mock';
import { testData } from '../../fixtures/test-data';
import { generateAccessToken } from '../../../utils/jwt.utils';

// Mock dependencies
jest.mock('../../../services/databricks.service', () => {
  const { mockDatabricksService } = require('../../mocks/databricks.mock');
  return { databricksService: mockDatabricksService };
});

jest.mock('../../../middleware/auth.middleware');

/**
 * Roster API Integration Tests - Simplified COPPA Compliance
 * 
 * Tests the roster management API with the new boolean-based age/consent system
 */
describe('Roster Routes Integration Tests', () => {
  let app: express.Application;
  let authToken: string;
  const teacher = testData.teachers.active;
  const school = testData.schools.active;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup Express app
    app = express();
    app.use(express.json());
    
    // Mock authentication middleware
    (authenticate as jest.Mock).mockImplementation((req, res, next) => {
      if (req.headers.authorization) {
        req.user = teacher;
        req.school = school;
        req.sessionId = 'auth-session-id';
        next();
      } else {
        res.status(401).json({ error: 'Unauthorized' });
      }
    });
    
    // Mount routes
    app.use('/api/v1/roster', rosterRoutes);
    app.use(errorHandler);
    
    // Generate auth token
    authToken = generateAccessToken(teacher, school, 'auth-session-id');
    
    // Reset mocks
    mockDatabricksService.recordAuditLog.mockResolvedValue(true);
  });

  describe('GET /api/v1/roster/students', () => {
    const mockStudents = [
      {
        id: 'student-1',
        name: 'John Doe',
        email: null,
        grade_level: '5th',
        status: 'active',
        has_parental_consent: false,
        consent_date: null,
        parent_email: null,
        data_sharing_consent: false,
        audio_recording_consent: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        school_name: 'Test School',
      },
      {
        id: 'student-2',
        name: 'Jane Smith',
        email: null,
        grade_level: '3rd',
        status: 'active',
        has_parental_consent: true,
        consent_date: new Date().toISOString(),
        parent_email: 'parent@example.com',
        data_sharing_consent: true,
        audio_recording_consent: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        school_name: 'Test School',
      },
    ];

    it('should list students in school roster', async () => {
      mockDatabricksService.query.mockResolvedValueOnce(mockStudents);
      mockDatabricksService.queryOne.mockResolvedValueOnce({ total: 2 });

      const response = await request(app)
        .get('/api/v1/roster/students')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveLength(2);
      expect(response.body.total).toBe(2);
      expect(response.body.page).toBe(1);
      expect(response.body.limit).toBe(20);

      // Verify student data transformation
      const student1 = response.body.data[0];
      expect(student1).toMatchObject({
        id: 'student-1',
        firstName: 'John',
        lastName: 'Doe',
        gradeLevel: '5th',
        consentStatus: 'none', // No parent email or consent
        isUnderConsentAge: expect.any(Boolean),
      });

      const student2 = response.body.data[1];
      expect(student2).toMatchObject({
        id: 'student-2',
        firstName: 'Jane',
        lastName: 'Smith',
        gradeLevel: '3rd',
        consentStatus: 'granted', // Has parental consent
        parentEmail: 'parent@example.com',
      });
    });

    it('should filter students by grade level', async () => {
      mockDatabricksService.query.mockResolvedValueOnce([mockStudents[1]]);
      mockDatabricksService.queryOne.mockResolvedValueOnce({ total: 1 });

      const response = await request(app)
        .get('/api/v1/roster/students?gradeLevel=3rd')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].gradeLevel).toBe('3rd');
      
      // Verify query was called with correct parameters
      expect(mockDatabricksService.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE s.school_id = ? AND s.grade_level = ?'),
        [school.id, '3rd']
      );
    });

    it('should filter students by status', async () => {
      mockDatabricksService.query.mockResolvedValueOnce(mockStudents);
      mockDatabricksService.queryOne.mockResolvedValueOnce({ total: 2 });

      await request(app)
        .get('/api/v1/roster/students?status=active')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(mockDatabricksService.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE s.school_id = ? AND s.status = ?'),
        [school.id, 'active']
      );
    });

    it('should handle pagination correctly', async () => {
      mockDatabricksService.query.mockResolvedValueOnce([mockStudents[0]]);
      mockDatabricksService.queryOne.mockResolvedValueOnce({ total: 2 });

      const response = await request(app)
        .get('/api/v1/roster/students?page=2&limit=1')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.page).toBe(2);
      expect(response.body.limit).toBe(1);
      expect(response.body.total).toBe(2);
      
      // Verify query used correct LIMIT and OFFSET
      expect(mockDatabricksService.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT 1 OFFSET 1'),
        [school.id]
      );
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/v1/roster/students')
        .expect(401);
    });

    it('should log audit event', async () => {
      mockDatabricksService.query.mockResolvedValueOnce([]);
      mockDatabricksService.queryOne.mockResolvedValueOnce({ total: 0 });

      await request(app)
        .get('/api/v1/roster/students')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(mockDatabricksService.recordAuditLog).toHaveBeenCalledWith({
        actorId: teacher.id,
        actorType: 'teacher',
        eventType: 'student_roster_accessed',
        eventCategory: 'data_access',
        resourceType: 'student',
        resourceId: 'roster',
        schoolId: school.id,
        description: `Teacher ID ${teacher.id} accessed student roster`,
        ipAddress: expect.any(String),
        userAgent: expect.any(String),
        complianceBasis: 'legitimate_interest'
      });
    });
  });

  describe('POST /api/v1/roster/students', () => {
    const validStudentData = {
      firstName: 'New',
      lastName: 'Student',
      gradeLevel: '4th',
    };

    it('should create student 13 or older (no consent needed)', async () => {
      const studentData = {
        ...validStudentData,
        isUnderConsentAge: false,
      };

      // Mock no existing student and successful creation
      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing student
        .mockResolvedValueOnce({ // Created student
          id: 'new-student-id',
          display_name: 'New Student',
          grade_level: '4th',
          status: 'active',
          has_parental_consent: false,
          consent_date: null,
          parent_email: null,
          school_name: 'Test School',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      
      mockDatabricksService.query.mockResolvedValueOnce(true); // INSERT success

      const response = await request(app)
        .post('/api/v1/roster/students')
        .set('Authorization', `Bearer ${authToken}`)
        .send(studentData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        firstName: 'New',
        lastName: 'Student',
        gradeLevel: '4th',
        consentStatus: 'none',
        isUnderConsentAge: false,
      });

      // Verify database calls
      expect(mockDatabricksService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO classwaves.users.students'),
        expect.arrayContaining([
          expect.any(String), // studentId
          'New Student', // display_name
          school.id,
          null, // email
          '4th', // grade_level
          'active',
          false, // has_parental_consent
          null, // consent_date
          null, // parent_email
          false, // data_sharing_consent
          false, // audio_recording_consent
          expect.any(String), // created_at
          expect.any(String), // updated_at
        ])
      );
    });

    it('should create under-13 student with parental consent', async () => {
      const studentData = {
        ...validStudentData,
        isUnderConsentAge: true,
        hasParentalConsent: true,
        parentEmail: 'parent@example.com',
      };

      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing student
        .mockResolvedValueOnce({ // Created student
          id: 'young-student-id',
          display_name: 'New Student',
          grade_level: '4th',
          status: 'active',
          has_parental_consent: true,
          consent_date: expect.any(String),
          parent_email: 'parent@example.com',
          school_name: 'Test School',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      
      mockDatabricksService.query.mockResolvedValueOnce(true);

      const response = await request(app)
        .post('/api/v1/roster/students')
        .set('Authorization', `Bearer ${authToken}`)
        .send(studentData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        firstName: 'New',
        lastName: 'Student',
        parentEmail: 'parent@example.com',
        consentStatus: 'granted',
        isUnderConsentAge: true,
      });

      // Verify consent was recorded
      expect(mockDatabricksService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO classwaves.users.students'),
        expect.arrayContaining([
          expect.any(String),
          'New Student',
          school.id,
          null,
          '4th',
          'active',
          true, // has_parental_consent = true
          expect.any(String), // consent_date set
          'parent@example.com',
          false,
          false,
          expect.any(String),
          expect.any(String),
        ])
      );
    });

    it('should reject under-13 student without parental consent', async () => {
      const studentData = {
        ...validStudentData,
        isUnderConsentAge: true,
        hasParentalConsent: false,
      };

      const response = await request(app)
        .post('/api/v1/roster/students')
        .set('Authorization', `Bearer ${authToken}`)
        .send(studentData)
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'PARENTAL_CONSENT_REQUIRED',
        message: 'Parental consent is required for students under 13',
        requiresParentalConsent: true,
      });

      // Should not call database
      expect(mockDatabricksService.query).not.toHaveBeenCalled();
    });

    it('should reject duplicate student names', async () => {
      mockDatabricksService.queryOne.mockResolvedValueOnce({ id: 'existing-student' });

      const response = await request(app)
        .post('/api/v1/roster/students')
        .set('Authorization', `Bearer ${authToken}`)
        .send(validStudentData)
        .expect(409);

      expect(response.body).toMatchObject({
        success: false,
        error: 'STUDENT_EXISTS',
        message: 'A student with this name already exists in the roster',
      });
    });

    it('should validate required fields', async () => {
      const invalidData = {
        firstName: '', // Invalid - required
        lastName: 'Student',
      };

      await request(app)
        .post('/api/v1/roster/students')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData)
        .expect(400);
    });

    it('should validate first name length limit', async () => {
      const invalidData = {
        firstName: 'A'.repeat(51), // Over 50 character limit
        lastName: 'Student',
      };

      await request(app)
        .post('/api/v1/roster/students')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData)
        .expect(400);
    });

    it('should validate parent email format when provided', async () => {
      const invalidData = {
        ...validStudentData,
        parentEmail: 'not-an-email',
      };

      await request(app)
        .post('/api/v1/roster/students')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData)
        .expect(400);
    });

    it('should log audit event for student creation', async () => {
      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'new-student-id',
          display_name: 'New Student',
          grade_level: '4th',
          status: 'active',
          has_parental_consent: false,
          consent_date: null,
          parent_email: null,
          school_name: 'Test School',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      
      mockDatabricksService.query.mockResolvedValueOnce(true);

      await request(app)
        .post('/api/v1/roster/students')
        .set('Authorization', `Bearer ${authToken}`)
        .send(validStudentData)
        .expect(201);

      expect(mockDatabricksService.recordAuditLog).toHaveBeenCalledWith({
        actorId: teacher.id,
        actorType: 'teacher',
        eventType: 'student_created',
        eventCategory: 'configuration',
        resourceType: 'student',
        resourceId: expect.any(String),
        schoolId: school.id,
        description: expect.stringContaining('Teacher ID teacher-active-123 added student: New Student'),
        ipAddress: expect.any(String),
        userAgent: expect.any(String),
        complianceBasis: 'legitimate_interest',
        affectedStudentIds: [expect.any(String)],
      });
    });

    it('should require authentication', async () => {
      await request(app)
        .post('/api/v1/roster/students')
        .send(validStudentData)
        .expect(401);
    });
  });

  describe('COPPA Compliance - Simplified Boolean System', () => {
    it('should handle teacher-confirmed under-13 status correctly', async () => {
      const under13StudentData = {
        firstName: 'Young',
        lastName: 'Student',
        gradeLevel: '2nd',
        isUnderConsentAge: true,
        hasParentalConsent: true,
        parentEmail: 'parent@school.edu',
      };

      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'young-student-id',
          display_name: 'Young Student',
          grade_level: '2nd',
          status: 'active',
          has_parental_consent: true,
          consent_date: new Date().toISOString(),
          parent_email: 'parent@school.edu',
          school_name: 'Test School',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      
      mockDatabricksService.query.mockResolvedValueOnce(true);

      const response = await request(app)
        .post('/api/v1/roster/students')
        .set('Authorization', `Bearer ${authToken}`)
        .send(under13StudentData)
        .expect(201);

      // Verify system stores teacher's assessment correctly
      expect(response.body.data.isUnderConsentAge).toBe(true);
      expect(response.body.data.consentStatus).toBe('granted');
      expect(response.body.data.parentEmail).toBe('parent@school.edu');

      // Verify audit log mentions age status
      expect(mockDatabricksService.recordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringContaining('(under 13)'),
        })
      );
    });

    it('should not store or expose date of birth', async () => {
      const studentData = {
        firstName: 'Test',
        lastName: 'Student',
        dateOfBirth: '2010-01-01', // This should be ignored
        birthDate: '2010-01-01',   // This should be ignored
        age: 12,                   // This should be ignored
      };

      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'test-student-id',
          display_name: 'Test Student',
          status: 'active',
          has_parental_consent: false,
          school_name: 'Test School',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      
      mockDatabricksService.query.mockResolvedValueOnce(true);

      const response = await request(app)
        .post('/api/v1/roster/students')
        .set('Authorization', `Bearer ${authToken}`)
        .send(studentData)
        .expect(201);

      // Response should not include DOB or age
      expect(response.body.data).not.toHaveProperty('dateOfBirth');
      expect(response.body.data).not.toHaveProperty('birthDate');
      expect(response.body.data).not.toHaveProperty('age');

      // Database call should not include birth_date
      const insertCall = mockDatabricksService.query.mock.calls.find(call => 
        call[0].includes('INSERT INTO classwaves.users.students')
      );
      expect(insertCall[0]).not.toContain('birth_date');
      expect(insertCall[1]).not.toContain('2010-01-01');
    });

    it('should enforce parental consent validation for under-13 students', async () => {
      const testCases = [
        {
          description: 'under 13 with consent should succeed',
          data: { isUnderConsentAge: true, hasParentalConsent: true },
          expectedStatus: 201,
        },
        {
          description: 'under 13 without consent should fail',
          data: { isUnderConsentAge: true, hasParentalConsent: false },
          expectedStatus: 400,
        },
        {
          description: '13+ should succeed regardless of consent field',
          data: { isUnderConsentAge: false, hasParentalConsent: false },
          expectedStatus: 201,
        },
      ];

      for (const testCase of testCases) {
        jest.clearAllMocks();
        
        if (testCase.expectedStatus === 201) {
          mockDatabricksService.queryOne
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
              id: 'test-id',
              display_name: 'Test Student',
              status: 'active',
              has_parental_consent: testCase.data.hasParentalConsent,
              school_name: 'Test School',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          mockDatabricksService.query.mockResolvedValueOnce(true);
        }

        const response = await request(app)
          .post('/api/v1/roster/students')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            firstName: 'Test',
            lastName: 'Student',
            ...testCase.data,
          });

        expect(response.status).toBe(testCase.expectedStatus);
        
        if (testCase.expectedStatus === 400) {
          expect(response.body.error).toBe('PARENTAL_CONSENT_REQUIRED');
        }
      }
    });
  });

  describe('Legacy Data Compatibility', () => {
    it('should handle existing students without boolean consent fields', async () => {
      // Mock students that were created before the boolean system
      const legacyStudents = [
        {
          id: 'legacy-student-1',
          name: 'Legacy Student',
          email: null,
          grade_level: '5th',
          status: 'active',
          has_parental_consent: null, // Legacy: no boolean field
          consent_date: null,
          parent_email: 'parent@example.com', // Has parent email
          data_sharing_consent: false,
          audio_recording_consent: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          school_name: 'Test School',
        },
        {
          id: 'legacy-student-2',
          name: 'Another Legacy',
          email: null,
          grade_level: '8th',
          status: 'active',
          has_parental_consent: null,
          consent_date: null,
          parent_email: null, // No parent email
          data_sharing_consent: false,
          audio_recording_consent: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          school_name: 'Test School',
        },
      ];

      mockDatabricksService.query.mockResolvedValueOnce(legacyStudents);
      mockDatabricksService.queryOne.mockResolvedValueOnce({ total: 2 });

      const response = await request(app)
        .get('/api/v1/roster/students')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Should infer consent status from parent_email
      const student1 = response.body.data[0];
      expect(student1.consentStatus).toBe('required'); // Has parent email

      const student2 = response.body.data[1];
      expect(student2.consentStatus).toBe('none'); // No parent email
    });
  });
});

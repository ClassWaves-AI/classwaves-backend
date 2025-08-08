import { DBSQLClient } from '@databricks/sql';
import { databricksService } from '../../../services/databricks.service';
import { mockDBSQLClient } from '../../mocks/databricks.mock';
import { testData } from '../../fixtures/test-data';

// Mock the @databricks/sql module
jest.mock('@databricks/sql', () => ({
  DBSQLClient: jest.fn().mockImplementation(() => mockDBSQLClient),
}));

describe('DatabricksService', () => {
  let mockConnection: any;
  let mockSession: any;
  let mockOperation: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup mock operation
    mockOperation = {
      fetchAll: jest.fn().mockResolvedValue({ rows: [], metadata: {} }),
      fetchChunk: jest.fn().mockResolvedValue({ rows: [], hasMoreRows: false }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    
    // Setup mock session
    mockSession = {
      executeStatement: jest.fn().mockResolvedValue(mockOperation),
      close: jest.fn().mockResolvedValue(undefined),
    };
    
    // Setup mock connection
    mockConnection = {
      openSession: jest.fn().mockResolvedValue(mockSession),
      close: jest.fn().mockResolvedValue(undefined),
    };
    
    mockDBSQLClient.connect.mockResolvedValue(mockConnection);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('connect', () => {
    it('should establish database connection', async () => {
      await databricksService.connect();

      expect(DBSQLClient).toHaveBeenCalledWith({
        authType: 'access-token',
        token: expect.any(String),
        host: expect.any(String),
        path: expect.any(String),
      });
      expect(mockDBSQLClient.connect).toHaveBeenCalled();
    });

    it('should handle connection errors', async () => {
      mockDBSQLClient.connect.mockRejectedValue(new Error('Connection failed'));

      await expect(databricksService.connect()).rejects.toThrow('Connection failed');
    });
  });

  describe('disconnect', () => {
    it('should close database connection', async () => {
      await databricksService.connect();
      await databricksService.disconnect();

      expect(mockDBSQLClient.close).toHaveBeenCalled();
    });
  });

  describe('insert', () => {
    it('should insert data and return generated ID', async () => {
      await databricksService.connect();
      
      const data = {
        name: 'Test Item',
        status: 'active',
      };

      const id = await databricksService.insert('test_table', data);

      expect(mockSession.executeStatement).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO'),
        expect.any(Object)
      );
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });

  describe('update', () => {
    it('should update existing record', async () => {
      await databricksService.connect();
      
      const data = {
        name: 'Updated Name',
        status: 'inactive',
      };

      await databricksService.update('test_table', 'test-id-123', data);

      expect(mockSession.executeStatement).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE'),
        expect.any(Object)
      );
    });
  });

  describe('delete', () => {
    it('should delete record by ID', async () => {
      await databricksService.connect();

      await databricksService.delete('test_table', 'test-id-123');

      expect(mockSession.executeStatement).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM'),
        expect.any(Object)
      );
    });
  });

  describe('getSchoolByDomain', () => {
    it('should return school when domain exists', async () => {
      const school = testData.schools.active;
      mockOperation.fetchChunk.mockResolvedValue({ 
        rows: [school], 
        hasMoreRows: false 
      });

      await databricksService.connect();
      const result = await databricksService.getSchoolByDomain('activeschool.edu');

      expect(mockSession.executeStatement).toHaveBeenCalledWith(
        expect.stringContaining('WHERE domain = ?'),
        expect.any(Object)
      );
      expect(result).toEqual(school);
    });

    it('should return null when domain not found', async () => {
      mockOperation.fetchChunk.mockResolvedValue({ 
        rows: [], 
        hasMoreRows: false 
      });

      await databricksService.connect();
      const result = await databricksService.getSchoolByDomain('nonexistent.edu');

      expect(result).toBeNull();
    });
  });

  describe('upsertTeacher', () => {
    const teacherData = {
      google_id: 'google-123',
      email: 'teacher@school.edu',
      name: 'Test Teacher',
      picture: 'https://example.com/pic.jpg',
      school_id: 'school-123',
    };

    it('should create new teacher when not exists', async () => {
      // getTeacherByGoogleId returns null
      mockOperation.fetchChunk.mockResolvedValueOnce({ 
        rows: [], 
        hasMoreRows: false 
      });
      
      // Insert operation
      mockOperation.fetchAll.mockResolvedValueOnce({ 
        rows: [],
        metadata: { rowCount: 1 }
      });
      
      // getTeacherByGoogleId returns new teacher
      const newTeacher = { ...testData.teachers.active, ...teacherData };
      mockOperation.fetchChunk.mockResolvedValueOnce({ 
        rows: [newTeacher], 
        hasMoreRows: false 
      });

      await databricksService.connect();
      const result = await databricksService.upsertTeacher(teacherData);

      expect(result).toEqual(newTeacher);
    });

    it('should update existing teacher', async () => {
      const existingTeacher = { ...testData.teachers.active };
      
      // getTeacherByGoogleId returns existing teacher
      mockOperation.fetchChunk.mockResolvedValueOnce({ 
        rows: [existingTeacher], 
        hasMoreRows: false 
      });
      
      // Update operation
      mockOperation.fetchAll.mockResolvedValueOnce({ 
        rows: [],
        metadata: { rowCount: 1 }
      });
      
      // getTeacherByGoogleId returns updated teacher
      const updatedTeacher = { ...existingTeacher, ...teacherData };
      mockOperation.fetchChunk.mockResolvedValueOnce({ 
        rows: [updatedTeacher], 
        hasMoreRows: false 
      });

      await databricksService.connect();
      const result = await databricksService.upsertTeacher(teacherData);

      expect(result).toEqual(updatedTeacher);
    });
  });

  describe('createSession', () => {
    it('should create new session', async () => {
      const sessionData = {
        title: 'Test Session',
        description: 'Test description',
        teacherId: 'teacher-123',
        schoolId: 'school-123',
        maxStudents: 30,
        targetGroupSize: 4,
        autoGroupEnabled: true,
      };

      mockOperation.fetchAll.mockResolvedValue({ 
        rows: [],
        metadata: { rowCount: 1 }
      });

      await databricksService.connect();
      const sessionId = await databricksService.createSession(sessionData);

      expect(mockSession.executeStatement).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO classwaves.sessions.sessions'),
        expect.any(Object)
      );
      expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });

  describe('updateSessionStatus', () => {
    it('should update session status to active', async () => {
      mockOperation.fetchAll.mockResolvedValue({ 
        rows: [],
        metadata: { rowCount: 1 }
      });

      await databricksService.connect();
      await databricksService.updateSessionStatus('session-123', 'active', {
        actual_start: new Date(),
      });

      expect(mockSession.executeStatement).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE classwaves.sessions.sessions'),
        expect.any(Object)
      );
    });

    it('should update session status to ended with duration', async () => {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 60 * 60 * 1000); // 1 hour ago

      mockOperation.fetchAll.mockResolvedValue({ 
        rows: [],
        metadata: { rowCount: 1 }
      });

      await databricksService.connect();
      await databricksService.updateSessionStatus('session-123', 'ended', {
        actual_end: endTime,
        actual_duration_minutes: 60,
      });

      expect(mockSession.executeStatement).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE classwaves.sessions.sessions'),
        expect.any(Object)
      );
    });
  });

  describe('recordAuditLog', () => {
    it('should record audit log entry', async () => {
      const auditData = {
        actorId: 'teacher-123',
        actorType: 'teacher' as const,
        eventType: 'login',
        eventCategory: 'authentication' as const,
        resourceType: 'session',
        resourceId: 'session-123',
        schoolId: 'school-123',
        description: 'Teacher logged in',
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
        complianceBasis: 'legitimate_interest' as const,
      };

      mockOperation.fetchAll.mockResolvedValue({ 
        rows: [],
        metadata: { rowCount: 1 }
      });

      await databricksService.connect();
      await databricksService.recordAuditLog(auditData);

      expect(mockSession.executeStatement).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO classwaves.analytics.audit_logs'),
        expect.any(Object)
      );
    });
  });

  describe('getTeacherSessions', () => {
    it('should return teacher sessions with counts', async () => {
      const sessions = [
        { ...testData.sessions.active, group_count: 5, student_count: 20 },
        { ...testData.sessions.created, group_count: 0, student_count: 0 },
      ];

      mockOperation.fetchChunk.mockResolvedValue({ 
        rows: sessions, 
        hasMoreRows: false 
      });

      await databricksService.connect();
      const result = await databricksService.getTeacherSessions('teacher-123');

      expect(mockSession.executeStatement).toHaveBeenCalledWith(
        expect.stringContaining('WHERE s.teacher_id = ?'),
        expect.any(Object)
      );
      expect(result).toEqual(sessions);
    });

    it('should limit results when specified', async () => {
      mockOperation.fetchChunk.mockResolvedValue({ 
        rows: [], 
        hasMoreRows: false 
      });

      await databricksService.connect();
      await databricksService.getTeacherSessions('teacher-123', 10);

      expect(mockSession.executeStatement).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT 10'),
        expect.any(Object)
      );
    });
  });

  describe('error handling', () => {
    it('should handle statement execution errors', async () => {
      mockSession.executeStatement.mockRejectedValue(new Error('SQL syntax error'));

      await databricksService.connect();
      await expect(databricksService.getSchoolByDomain('test.edu'))
        .rejects.toThrow('SQL syntax error');
    });

    it('should close resources on error', async () => {
      mockSession.executeStatement.mockRejectedValue(new Error('Query failed'));

      await databricksService.connect();
      
      try {
        await databricksService.getSchoolByDomain('test.edu');
      } catch (error) {
        // Expected error
      }

      expect(mockOperation.close).toHaveBeenCalled();
      expect(mockSession.close).toHaveBeenCalled();
    });
  });
});
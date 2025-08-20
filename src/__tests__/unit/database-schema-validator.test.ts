/**
 * Unit Tests for Database Schema Validator
 * 
 * Tests the database schema validation logic with mocked Databricks responses.
 * Ensures proper error handling and validation logic without requiring live database connection.
 * 
 * PLATFORM STABILIZATION: Task 1.8 [P1] - Critical Path Infrastructure Testing
 */

import { DatabaseSchemaValidator, ValidationReport } from '../../scripts/database-schema-validator';
import { DatabricksService } from '../../services/databricks.service';

// Mock the DatabricksService
jest.mock('../../services/databricks.service');
jest.mock('../../config/databricks.config', () => ({
  databricksConfig: {
    catalog: 'classwaves'
  }
}));

const mockDatabricksService = DatabricksService as jest.MockedClass<typeof DatabricksService>;

describe('DatabaseSchemaValidator', () => {
  let validator: DatabaseSchemaValidator;
  let mockQuery: jest.MockedFunction<any>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create mock query function
    mockQuery = jest.fn();
    
    // Mock the DatabricksService instance
    mockDatabricksService.mockImplementation(() => ({
      query: mockQuery,
      connect: jest.fn(),
      queryOne: jest.fn(),
      insert: jest.fn(),
      generateId: jest.fn()
    } as any));

    validator = new DatabaseSchemaValidator();
  });

  describe('validateSchema', () => {
    it('should complete successfully with all schemas and tables present', async () => {
      // Mock successful connection test
      mockQuery
        .mockResolvedValueOnce([{ connection_test: 1 }]) // Connection test
        .mockResolvedValueOnce([]); // USE CATALOG
        
      // The validator calls SHOW SCHEMAS separately for each schema validation
      // Mock SHOW SCHEMAS 5 times (once per schema: users, sessions, analytics, compliance, ai_insights)
      const allSchemas = [
        { schema_name: 'users' },
        { schema_name: 'sessions' },
        { schema_name: 'analytics' },
        { schema_name: 'compliance' },
        { schema_name: 'ai_insights' }
      ];
      
      for (let i = 0; i < 5; i++) {
        mockQuery.mockResolvedValueOnce(allSchemas);
      }

      // Mock SHOW TABLES IN {catalog}.{schema} for each schema
      // The validator calls this for each valid schema: users, sessions, analytics, compliance, ai_insights
      
      // SHOW TABLES IN classwaves.users
      mockQuery.mockResolvedValueOnce([
        { tableName: 'schools', table_name: 'schools' },
        { tableName: 'teachers', table_name: 'teachers' },
        { tableName: 'students', table_name: 'students' }
      ]);
      
      // SHOW TABLES IN classwaves.sessions  
      mockQuery.mockResolvedValueOnce([
        { tableName: 'classroom_sessions', table_name: 'classroom_sessions' },
        { tableName: 'student_groups', table_name: 'student_groups' },
        { tableName: 'participants', table_name: 'participants' }
      ]);
      
      // SHOW TABLES IN classwaves.analytics
      mockQuery.mockResolvedValueOnce([
        { tableName: 'session_metrics', table_name: 'session_metrics' },
        { tableName: 'group_metrics', table_name: 'group_metrics' }
      ]);
      
      // SHOW TABLES IN classwaves.compliance  
      mockQuery.mockResolvedValueOnce([
        { tableName: 'audit_log', table_name: 'audit_log' }
      ]);
      
      // SHOW TABLES IN classwaves.ai_insights
      mockQuery.mockResolvedValueOnce([
        { tableName: 'analysis_results', table_name: 'analysis_results' }
      ]);

      // Mock DESCRIBE TABLE responses for each table
      // The validator calls DESCRIBE TABLE for each table, so we need to mock each call
      // Order: users.schools, users.teachers, users.students, sessions.classroom_sessions, sessions.student_groups, sessions.participants, analytics.session_metrics, analytics.group_metrics, compliance.audit_log, ai_insights.analysis_results
      
      mockQuery.mockResolvedValueOnce([
        { col_name: 'id' }, { col_name: 'name' }, { col_name: 'domain' }, { col_name: 'subscription_status' }
      ]); // users.schools
      
      mockQuery.mockResolvedValueOnce([
        { col_name: 'id' }, { col_name: 'email' }, { col_name: 'school_id' }, { col_name: 'google_id' }
      ]); // users.teachers
      
      mockQuery.mockResolvedValueOnce([
        { col_name: 'id' }, { col_name: 'name' }, { col_name: 'email' }, { col_name: 'session_id' }
      ]); // users.students
      
      mockQuery.mockResolvedValueOnce([
        { col_name: 'id' }, { col_name: 'teacher_id' }, { col_name: 'title' }, { col_name: 'status' }, { col_name: 'access_code' }
      ]); // sessions.classroom_sessions
      
      mockQuery.mockResolvedValueOnce([
        { col_name: 'id' }, { col_name: 'session_id' }, { col_name: 'name' }, { col_name: 'leader_id' }
      ]); // sessions.student_groups
      
      mockQuery.mockResolvedValueOnce([
        { col_name: 'id' }, { col_name: 'session_id' }, { col_name: 'group_id' }, { col_name: 'student_id' }
      ]); // sessions.participants
      
      mockQuery.mockResolvedValueOnce([
        { col_name: 'id' }, { col_name: 'session_id' }, { col_name: 'metric_type' }, { col_name: 'value' }
      ]); // analytics.session_metrics
      
      mockQuery.mockResolvedValueOnce([
        { col_name: 'id' }, { col_name: 'group_id' }, { col_name: 'metric_type' }, { col_name: 'value' }
      ]); // analytics.group_metrics
      
      mockQuery.mockResolvedValueOnce([
        { col_name: 'id' }, { col_name: 'event_type' }, { col_name: 'actor_id' }, { col_name: 'created_at' }
      ]); // compliance.audit_log
      
      mockQuery.mockResolvedValueOnce([
        { col_name: 'id' }, { col_name: 'session_id' }, { col_name: 'analysis_type' }, { col_name: 'result_data' }
      ]); // ai_insights.analysis_results

      // Mock current catalog check
      mockQuery.mockResolvedValueOnce([{ catalog: 'classwaves' }]);

      const result = await validator.validateSchema();

      // Debug: Show what's actually happening if test fails
      if (!result.success) {
        throw new Error(`Test Debug - Critical Errors: ${JSON.stringify(result.criticalErrors)} | Summary: validSchemas=${result.summary.validSchemas}/${result.summary.totalSchemas}, validTables=${result.summary.validTables}/${result.summary.totalTables}, criticalIssues=${result.summary.criticalIssues}`);
      }

      expect(result.success).toBe(true);
      expect(result.criticalErrors).toHaveLength(0);
      expect(result.summary.validSchemas).toBe(5);
      expect(result.executionTime).toBeGreaterThan(0);
    });

    it('should fail when connection cannot be established', async () => {
      // Mock connection failure
      mockQuery.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await validator.validateSchema();

      expect(result.success).toBe(false);
      expect(result.criticalErrors.length).toBeGreaterThan(0);
      expect(result.criticalErrors[0]).toContain('Database connection failed');
    });

    it('should detect missing schemas', async () => {
      // Mock successful connection
      mockQuery
        .mockResolvedValueOnce([{ connection_test: 1 }]) // Connection test
        .mockResolvedValueOnce([]) // USE CATALOG
        .mockResolvedValueOnce([ // SHOW SCHEMAS - missing some schemas
          { schema_name: 'users' },
          { schema_name: 'sessions' }
          // Missing: analytics, compliance, ai_insights
        ])
        // Mock SHOW TABLES for existing schemas
        .mockResolvedValueOnce([
          { tableName: 'schools' },
          { tableName: 'teachers' },
          { tableName: 'students' }
        ])
        .mockResolvedValueOnce([
          { tableName: 'classroom_sessions' },
          { tableName: 'student_groups' },
          { tableName: 'participants' }
        ])
        // Mock DESCRIBE TABLE for existing tables
        .mockResolvedValueOnce([{ col_name: 'id' }, { col_name: 'name' }, { col_name: 'domain' }, { col_name: 'subscription_status' }])
        .mockResolvedValueOnce([{ col_name: 'id' }, { col_name: 'email' }, { col_name: 'school_id' }, { col_name: 'google_id' }])
        .mockResolvedValueOnce([{ col_name: 'id' }, { col_name: 'name' }, { col_name: 'email' }, { col_name: 'session_id' }])
        .mockResolvedValueOnce([{ col_name: 'id' }, { col_name: 'teacher_id' }, { col_name: 'title' }, { col_name: 'status' }, { col_name: 'access_code' }])
        .mockResolvedValueOnce([{ col_name: 'id' }, { col_name: 'session_id' }, { col_name: 'name' }, { col_name: 'leader_id' }])
        .mockResolvedValueOnce([{ col_name: 'id' }, { col_name: 'session_id' }, { col_name: 'group_id' }, { col_name: 'student_id' }])
        // Mock current catalog check for test data isolation
        .mockResolvedValueOnce([{ catalog: 'classwaves' }]);

      const result = await validator.validateSchema();

      expect(result.success).toBe(false);
      expect(result.criticalErrors).toContain("Schema 'analytics' does not exist in catalog 'classwaves'");
      expect(result.criticalErrors).toContain("Schema 'compliance' does not exist in catalog 'classwaves'");
      expect(result.criticalErrors).toContain("Schema 'ai_insights' does not exist in catalog 'classwaves'");
    });

    it('should detect missing tables within existing schemas', async () => {
      // Mock successful connection and schema existence
      mockQuery
        .mockResolvedValueOnce([{ connection_test: 1 }]) // Connection test
        .mockResolvedValueOnce([]) // USE CATALOG
        .mockResolvedValueOnce([ // SHOW SCHEMAS
          { schema_name: 'users' }
        ]);

      // Mock SHOW TABLES with missing tables
      mockQuery.mockResolvedValueOnce([
        { tableName: 'schools' }
        // Missing: teachers, students
      ]);

      const result = await validator.validateSchema();

      expect(result.success).toBe(false);
      expect(result.criticalErrors).toContain("Table 'users.teachers' does not exist");
      expect(result.criticalErrors).toContain("Table 'users.students' does not exist");
    });

    it('should detect missing required columns', async () => {
      // Mock successful connection, schema and table existence
      mockQuery
        .mockResolvedValueOnce([{ connection_test: 1 }]) // Connection test
        .mockResolvedValueOnce([]) // USE CATALOG
        .mockResolvedValueOnce([{ schema_name: 'users' }]) // SHOW SCHEMAS
        .mockResolvedValueOnce([{ tableName: 'schools' }]) // SHOW TABLES
        .mockResolvedValueOnce([ // DESCRIBE TABLE - missing required columns
          { col_name: 'id' },
          { col_name: 'name' }
          // Missing: domain, subscription_status
        ]);

      const result = await validator.validateSchema();

      expect(result.success).toBe(false);
      expect(result.criticalErrors).toContain("Table 'users.schools' is missing columns: domain, subscription_status");
    });

    it('should handle Databricks query errors gracefully', async () => {
      // Mock successful connection
      mockQuery
        .mockResolvedValueOnce([{ connection_test: 1 }]) // Connection test
        .mockResolvedValueOnce([]) // USE CATALOG
        .mockResolvedValueOnce([{ schema_name: 'users' }]) // SHOW SCHEMAS
        .mockRejectedValueOnce(new Error('Permission denied')); // SHOW TABLES fails

      const result = await validator.validateSchema();

      expect(result.success).toBe(false);
      expect(result.criticalErrors).toContain("Failed to validate schema 'users': Permission denied");
    });

    it('should complete validation within performance target', async () => {
      // Mock minimal successful validation
      mockQuery
        .mockResolvedValueOnce([{ connection_test: 1 }]) // Connection test
        .mockResolvedValueOnce([]) // USE CATALOG
        .mockResolvedValueOnce([]) // SHOW SCHEMAS - empty
        .mockResolvedValueOnce([{ catalog: 'classwaves' }]); // Current catalog

      const result = await validator.validateSchema();

      // Should complete in well under 30 seconds (our target)
      expect(result.executionTime).toBeLessThan(30000); // 30 seconds in ms
      // For unit tests, should be much faster
      expect(result.executionTime).toBeLessThan(1000); // 1 second for mocked responses
    });

    it('should handle catalog mismatch warnings', async () => {
      // Mock successful validation with catalog mismatch
      mockQuery
        .mockResolvedValueOnce([{ connection_test: 1 }]) // Connection test
        .mockResolvedValueOnce([]) // USE CATALOG
        .mockResolvedValueOnce([]) // SHOW SCHEMAS - empty (no schemas found, but validation continues)
        .mockResolvedValueOnce([{ catalog: 'different_catalog' }]); // Wrong catalog for test data isolation

      const result = await validator.validateSchema();

      expect(result.warnings).toContain("Using catalog 'different_catalog' instead of expected 'classwaves'");
    });
  });

  describe('validation report structure', () => {
    it('should return properly structured validation report', async () => {
      // Mock minimal validation
      mockQuery
        .mockResolvedValueOnce([{ connection_test: 1 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ catalog: 'classwaves' }]);

      const result = await validator.validateSchema();

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('executionTime');
      expect(result).toHaveProperty('schemaResults');
      expect(result).toHaveProperty('criticalErrors');
      expect(result).toHaveProperty('warnings');
      expect(result).toHaveProperty('summary');
      
      expect(result.summary).toHaveProperty('totalSchemas');
      expect(result.summary).toHaveProperty('validSchemas');
      expect(result.summary).toHaveProperty('totalTables');
      expect(result.summary).toHaveProperty('validTables');
      expect(result.summary).toHaveProperty('criticalIssues');
    });
  });
});

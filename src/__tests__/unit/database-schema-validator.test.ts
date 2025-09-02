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
      const allSchemas = [
        { schema_name: 'users' },
        { schema_name: 'sessions' },
        { schema_name: 'analytics' },
        { schema_name: 'compliance' },
        { schema_name: 'ai_insights' }
      ];
      const tablesBySchema: Record<string, any[]> = {
        users: [
          { tableName: 'schools' },
          { tableName: 'teachers' },
          { tableName: 'students' }
        ],
        sessions: [
          { tableName: 'classroom_sessions' },
          { tableName: 'student_groups' },
          { tableName: 'participants' }
        ],
        analytics: [
          { tableName: 'session_metrics' },
          { tableName: 'group_metrics' }
        ],
        compliance: [
          { tableName: 'audit_log' }
        ],
        ai_insights: [
          { tableName: 'analysis_results' }
        ]
      };
      const describeColumns: Record<string, any[]> = {
        'classwaves.users.schools': [ { col_name: 'id' }, { col_name: 'name' }, { col_name: 'domain' }, { col_name: 'subscription_status' } ],
        'classwaves.users.teachers': [ { col_name: 'id' }, { col_name: 'email' }, { col_name: 'school_id' }, { col_name: 'google_id' } ],
        'classwaves.users.students': [ { col_name: 'id' }, { col_name: 'name' }, { col_name: 'email' }, { col_name: 'session_id' } ],
        'classwaves.sessions.classroom_sessions': [ { col_name: 'id' }, { col_name: 'teacher_id' }, { col_name: 'title' }, { col_name: 'status' }, { col_name: 'access_code' } ],
        'classwaves.sessions.student_groups': [ { col_name: 'id' }, { col_name: 'session_id' }, { col_name: 'name' }, { col_name: 'leader_id' } ],
        'classwaves.sessions.participants': [ { col_name: 'id' }, { col_name: 'session_id' }, { col_name: 'group_id' }, { col_name: 'student_id' } ],
        'classwaves.analytics.session_metrics': [ { col_name: 'id' }, { col_name: 'session_id' }, { col_name: 'metric_type' }, { col_name: 'value' } ],
        'classwaves.analytics.group_metrics': [ { col_name: 'id' }, { col_name: 'group_id' }, { col_name: 'metric_type' }, { col_name: 'value' } ],
        'classwaves.compliance.audit_log': [ { col_name: 'id' }, { col_name: 'event_type' }, { col_name: 'actor_id' }, { col_name: 'created_at' } ],
        'classwaves.ai_insights.analysis_results': [ { col_name: 'id' }, { col_name: 'session_id' }, { col_name: 'analysis_type' }, { col_name: 'result_data' } ],
      };

      mockQuery.mockImplementation((sql: string) => {
        if (/SELECT\s+1\s+as\s+connection_test/i.test(sql)) return Promise.resolve([{ connection_test: 1 }]);
        if (/USE\s+CATALOG/i.test(sql)) return Promise.resolve([]);
        if (/SHOW\s+SCHEMAS/i.test(sql)) return Promise.resolve(allSchemas);
        const showTablesMatch = sql.match(/SHOW\s+TABLES\s+IN\s+(\w+)\.(\w+)/i);
        if (showTablesMatch) {
          return Promise.resolve(tablesBySchema[showTablesMatch[2]] || []);
        }
        const describeMatch = sql.match(/DESCRIBE\s+TABLE\s+(\w+\.\w+\.\w+)/i);
        if (describeMatch) {
          return Promise.resolve(describeColumns[describeMatch[1]] || []);
        }
        if (/current_catalog\(\)/i.test(sql)) return Promise.resolve([{ catalog: 'classwaves' }]);
        return Promise.resolve([]);
      });

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
        .mockResolvedValueOnce([]); // USE CATALOG
      // SHOW SCHEMAS is called once per expected schema (5 times)
      for (let i = 0; i < 5; i++) {
        mockQuery.mockResolvedValueOnce([]);
      }
      // Current catalog check
      mockQuery.mockResolvedValueOnce([{ catalog: 'different_catalog' }]); // Wrong catalog for test data isolation

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

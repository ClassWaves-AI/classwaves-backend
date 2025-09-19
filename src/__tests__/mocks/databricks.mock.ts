// Mock Databricks connection
export const mockDatabricksConnection = {
  execute: jest.fn().mockResolvedValue({
    rows: jest.fn().mockResolvedValue([]),
    metadata: {
      columnNames: [],
      columnTypes: [],
    },
  }),
  close: jest.fn().mockResolvedValue(undefined),
};

// Mock Databricks service
export const mockDatabricksService = {
  getConnection: jest.fn().mockResolvedValue(mockDatabricksConnection),
  execute: jest.fn().mockResolvedValue([]),
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
  queryMany: jest.fn().mockResolvedValue([]),
  // School methods
  getSchoolByDomain: jest.fn().mockResolvedValue(null),
  getSchoolById: jest.fn().mockResolvedValue(null),
  createSchool: jest.fn().mockResolvedValue({
    id: 'school-123',
    name: 'Test School',
    domain: 'test.edu',
  }),
  updateSchool: jest.fn().mockResolvedValue(true),
  // Teacher methods
  getTeacherByEmail: jest.fn().mockResolvedValue(null),
  getTeacherById: jest.fn().mockResolvedValue(null),
  createTeacher: jest.fn().mockResolvedValue({
    id: 'teacher-123',
    email: 'teacher@test.edu',
    name: 'Test Teacher',
  }),
  updateTeacher: jest.fn().mockResolvedValue(true),
  upsertTeacher: jest.fn().mockResolvedValue({
    id: 'teacher-123',
    email: 'teacher@test.edu',
    name: 'Test Teacher',
  }),
  updateTeacherLoginInfo: jest.fn().mockResolvedValue(true),
  // Session methods
  createSession: jest.fn().mockResolvedValue({
    id: 'session-123',
    code: 'ABC123',
    name: 'Test Session',
  }),
  getSessionById: jest.fn().mockResolvedValue(null),
  getSessionByCode: jest.fn().mockResolvedValue(null),
  updateSessionStatus: jest.fn().mockResolvedValue(true),
  getTeacherSessions: jest.fn().mockResolvedValue([]),
  // Student methods
  addStudentToSession: jest.fn().mockResolvedValue({
    id: 'student-123',
    display_name: 'Student 1',
  }),
  removeStudentFromSession: jest.fn().mockResolvedValue(true),
  getSessionStudents: jest.fn().mockResolvedValue([]),
  updateStudentStatus: jest.fn().mockResolvedValue(true),
  // Group methods
  createGroup: jest.fn().mockResolvedValue({
    id: 'group-123',
    name: 'Group 1',
  }),
  getSessionGroups: jest.fn().mockResolvedValue([]),
  addStudentToGroup: jest.fn().mockResolvedValue(true),
  removeStudentFromGroup: jest.fn().mockResolvedValue(true),
  // Analytics methods
  recordSessionAnalytics: jest.fn().mockResolvedValue(true),
  getSessionAnalytics: jest.fn().mockResolvedValue([]),
  getTeacherAnalytics: jest.fn().mockResolvedValue([]),
  // Audit methods
  logAuditEvent: jest.fn().mockResolvedValue(true),
  getAuditLogs: jest.fn().mockResolvedValue([]),
  recordAuditLog: jest.fn().mockResolvedValue(true),
  // Missing methods referenced in tests
  insert: jest.fn().mockResolvedValue(undefined),
  upsert: jest.fn().mockResolvedValue(true),
  update: jest.fn().mockResolvedValue(undefined),
  delete: jest.fn().mockResolvedValue(true),
  generateId: jest.fn().mockReturnValue('mock-generated-id'),
  updateSession: jest.fn().mockResolvedValue(true),
  deleteSession: jest.fn().mockResolvedValue(true),
  updateGroup: jest.fn().mockResolvedValue(true),
  deleteGroup: jest.fn().mockResolvedValue(true),
  scheduleDataDeletion: jest.fn().mockResolvedValue(true),
  exportSessionData: jest.fn().mockResolvedValue({}),
};

// Helper to reset all Databricks mocks
export const resetDatabricksMocks = () => {
  Object.values(mockDatabricksConnection).forEach(mock => {
    if (typeof mock === 'function' && 'mockReset' in mock) {
      (mock as any).mockReset();
    }
  });
  
  Object.values(mockDatabricksService).forEach(mock => {
    if (typeof mock === 'function' && 'mockReset' in mock) {
      (mock as any).mockReset();
    }
  });
};

// Helper to setup Databricks query error
export const setupDatabricksError = (error: Error) => {
  mockDatabricksService.execute.mockRejectedValue(error);
  mockDatabricksService.queryOne.mockRejectedValue(error);
  mockDatabricksService.queryMany.mockRejectedValue(error);
};

// Helper to setup common query responses
export const setupDatabricksResponses = (responses: Record<string, any>) => {
  Object.entries(responses).forEach(([method, response]) => {
    if (mockDatabricksService[method as keyof typeof mockDatabricksService]) {
      (mockDatabricksService[method as keyof typeof mockDatabricksService] as any).mockResolvedValue(response);
    }
  });
};

// Mock data creators
export const createMockSchool = (overrides?: Partial<any>) => ({
  id: 'school-123',
  name: 'Test School',
  domain: 'test.edu',
  subscription_status: 'active',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

export const createMockTeacher = (overrides?: Partial<any>) => ({
  id: 'teacher-123',
  email: 'teacher@test.edu',
  name: 'Test Teacher',
  school_id: 'school-123',
  role: 'teacher',
  is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

export const mockDBSQLClient = {
  connect: jest.fn().mockResolvedValue(mockDatabricksConnection),
  close: jest.fn().mockResolvedValue(undefined),
};

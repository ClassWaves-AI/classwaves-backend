import { getDatabricksService, resetDatabricksServiceForTests } from '../../../services/databricks.service';

describe('DatabricksService — parameter substitution hardening', () => {
  let capturedSql: string;
  const makeFakeSession = () => {
    const fakeOperation = {
      fetchAll: jest.fn().mockResolvedValue([]),
      close: jest.fn().mockResolvedValue(undefined),
    } as any;
    return {
      executeStatement: jest.fn().mockImplementation((sql: string) => {
        capturedSql = sql;
        return Promise.resolve(fakeOperation);
      }),
    } as any;
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    capturedSql = '';
  });

  beforeAll(async () => {
    process.env.DATABRICKS_MOCK = '0';
    await resetDatabricksServiceForTests();
  });

  afterAll(async () => {
    delete process.env.DATABRICKS_MOCK;
    await resetDatabricksServiceForTests();
  });

  it("preserves '?' inside parameter values and escapes quotes", async () => {
    const svc = getDatabricksService();
    const fakeSession = makeFakeSession();
    // @ts-ignore accessing private method for test
    jest.spyOn(svc as any, 'getSession').mockResolvedValue(fakeSession);

    const sql = "INSERT INTO t (a,b) VALUES (?, ?)";
    const params = ["Ask: 'Why?'", 'Group showing topic drift (score: 20%)'];
    await svc.query(sql, params);

    expect(capturedSql).toContain("INSERT INTO t (a,b) VALUES (");
    // First param: quotes doubled, question mark preserved
    expect(capturedSql).toContain("'Ask: ''Why?'''" );
    // Second param present and fully quoted
    expect(capturedSql).toContain("'Group showing topic drift (score: 20%)'");
  });

  it('formats dates, booleans, and numbers correctly', async () => {
    const svc = getDatabricksService();
    const fakeSession = makeFakeSession();
    // @ts-ignore accessing private method for test
    jest.spyOn(svc as any, 'getSession').mockResolvedValue(fakeSession);

    const d = new Date('2020-01-01T00:00:00.000Z');
    const sql = 'INSERT INTO t (d,b,n) VALUES (?, ?, ?)';
    await svc.query(sql, [d, true, 42]);

    expect(capturedSql).toContain("'2020-01-01T00:00:00.000Z'");
    // booleans/numbers should be unquoted
    expect(capturedSql).toMatch(/\btrue\b/);
    expect(capturedSql).toMatch(/\b42\b/);
  });

  it('logs a warning on parameter count mismatch and proceeds safely', async () => {
    const svc = getDatabricksService();
    const fakeSession = makeFakeSession();
    // @ts-ignore accessing private method for test
    jest.spyOn(svc as any, 'getSession').mockResolvedValue(fakeSession);

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const sql = 'INSERT INTO t (a,b,c) VALUES (?, ?, ?)';
    await svc.query(sql, ['only-one-param']);

    expect(warnSpy).toHaveBeenCalled();
    const msg = String(warnSpy.mock.calls[0]?.[0] || '');
    expect(msg).toContain('param count mismatch');
    // Ensure the single provided param appears and remaining placeholders remain intact in the tail
    expect(capturedSql).toContain("'only-one-param'");
    // We should still see at least one '?' preserved because of under-supply of params
    expect(capturedSql.includes('?')).toBe(true);

    warnSpy.mockRestore();
  });
});

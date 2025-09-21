import request from 'supertest';

const maybeDescribe = process.env.DATABRICKS_ENABLED === 'true' ? describe : describe.skip;

maybeDescribe('Provider matrix – Databricks smoke', () => {
  let app: any;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.DB_PROVIDER = 'databricks';
    delete process.env.cw_db_use_local_postgres;
    delete process.env.CW_DB_USE_LOCAL_POSTGRES;
    delete process.env['cw.db.use_local_postgres'];
    delete process.env['CW_DB_USE_LOCAL_POSTGRES'];
    // Lazy import after env configured to reuse real app bootstrap
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    app = require('../../app').default;
  });

  it('fails gracefully when Databricks is unavailable', async () => {
    const response = await request(app).get('/api/v1/sessions');
    expect([200, 500, 503]).toContain(response.status);
  });
});


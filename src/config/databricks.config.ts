// Environment variables are loaded by app.ts

export const databricksConfig = {
  // Never default secrets or workspace identifiers in source; use env vars only
  host: process.env.DATABRICKS_HOST || '',
  token: process.env.DATABRICKS_TOKEN || '',
  warehouse: process.env.DATABRICKS_WAREHOUSE_ID || '',
  // These defaults are non-sensitive and safe for local/testing
  catalog: 'classwaves',
  schema: 'users' // Default schema, but we'll use fully qualified names
};

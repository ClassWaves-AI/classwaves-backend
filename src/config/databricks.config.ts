// Environment variables are loaded by app.ts

export const databricksConfig = {
  host: process.env.DATABRICKS_HOST || 'https://dbc-d5db37cb-5441.cloud.databricks.com',
  token: process.env.DATABRICKS_TOKEN,
  warehouse: process.env.DATABRICKS_WAREHOUSE_ID || '077a4c2149eade40',
  catalog: 'classwaves',
  schema: 'users' // Default schema, but we'll use fully qualified names
};
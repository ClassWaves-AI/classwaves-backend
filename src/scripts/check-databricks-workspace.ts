import https from 'https';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

async function checkDatabricksWorkspace() {
  const token = process.env.DATABRICKS_TOKEN || '';
  const host = process.env.DATABRICKS_HOST?.replace(/^https?:\/\//, '') || '';
  
  logger.debug('Checking Databricks workspace configuration...\n');
  logger.debug('Host:', host);
  logger.debug('Token prefix:', token.substring(0, 10) + '...\n');
  
  // Make a direct API call to list warehouses
  const options = {
    hostname: host,
    path: '/api/2.0/sql/warehouses',
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };
  
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        logger.debug('Response Status:', res.statusCode);
        logger.debug('Response Headers:', res.headers);
        
        if (res.statusCode === 200) {
          try {
            const warehouses = JSON.parse(data);
            logger.debug('\nWarehouses found:');
            
            if (warehouses.warehouses && warehouses.warehouses.length > 0) {
              warehouses.warehouses.forEach((wh: any) => {
                logger.debug(`\nWarehouse: ${wh.name}`);
                logger.debug(`- ID: ${wh.id}`);
                logger.debug(`- State: ${wh.state}`);
                logger.debug(`- Type: ${wh.warehouse_type}`);
                logger.debug(`- Cluster Size: ${wh.cluster_size}`);
                logger.debug(`- JDBC URL: ${wh.jdbc_url || 'N/A'}`);
                logger.debug(`- HTTP Path: ${wh.odbc_params?.path || 'N/A'}`);
              });
              
              // Look for our warehouse
              const ourWarehouse = warehouses.warehouses.find((wh: any) => 
                wh.id === process.env.DATABRICKS_WAREHOUSE_ID ||
                wh.id === '0' + Number(process.env.DATABRICKS_WAREHOUSE_ID).toString(16)
              );
              
              if (ourWarehouse) {
                logger.debug(`\n✅ Found matching warehouse!`);
                logger.debug(`Use this ID: ${ourWarehouse.id}`);
                if (ourWarehouse.odbc_params?.path) {
                  logger.debug(`HTTP Path: ${ourWarehouse.odbc_params.path}`);
                }
              }
            } else {
              logger.debug('No warehouses found in the workspace');
            }
            
            resolve(warehouses);
          } catch (e) {
            logger.error('Error parsing response:', e);
            logger.debug('Raw response:', data);
            reject(e);
          }
        } else {
          logger.debug('Error response:', data);
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    
    req.on('error', (e) => {
      logger.error('Request error:', e);
      reject(e);
    });
    
    req.end();
  });
}

checkDatabricksWorkspace().catch(console.error);
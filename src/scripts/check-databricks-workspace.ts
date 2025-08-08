import https from 'https';
import dotenv from 'dotenv';

dotenv.config();

async function checkDatabricksWorkspace() {
  const token = process.env.DATABRICKS_TOKEN || '';
  const host = process.env.DATABRICKS_HOST?.replace(/^https?:\/\//, '') || '';
  
  console.log('Checking Databricks workspace configuration...\n');
  console.log('Host:', host);
  console.log('Token prefix:', token.substring(0, 10) + '...\n');
  
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
        console.log('Response Status:', res.statusCode);
        console.log('Response Headers:', res.headers);
        
        if (res.statusCode === 200) {
          try {
            const warehouses = JSON.parse(data);
            console.log('\nWarehouses found:');
            
            if (warehouses.warehouses && warehouses.warehouses.length > 0) {
              warehouses.warehouses.forEach((wh: any) => {
                console.log(`\nWarehouse: ${wh.name}`);
                console.log(`- ID: ${wh.id}`);
                console.log(`- State: ${wh.state}`);
                console.log(`- Type: ${wh.warehouse_type}`);
                console.log(`- Cluster Size: ${wh.cluster_size}`);
                console.log(`- JDBC URL: ${wh.jdbc_url || 'N/A'}`);
                console.log(`- HTTP Path: ${wh.odbc_params?.path || 'N/A'}`);
              });
              
              // Look for our warehouse
              const ourWarehouse = warehouses.warehouses.find((wh: any) => 
                wh.id === process.env.DATABRICKS_WAREHOUSE_ID ||
                wh.id === '0' + Number(process.env.DATABRICKS_WAREHOUSE_ID).toString(16)
              );
              
              if (ourWarehouse) {
                console.log(`\n✅ Found matching warehouse!`);
                console.log(`Use this ID: ${ourWarehouse.id}`);
                if (ourWarehouse.odbc_params?.path) {
                  console.log(`HTTP Path: ${ourWarehouse.odbc_params.path}`);
                }
              }
            } else {
              console.log('No warehouses found in the workspace');
            }
            
            resolve(warehouses);
          } catch (e) {
            console.error('Error parsing response:', e);
            console.log('Raw response:', data);
            reject(e);
          }
        } else {
          console.log('Error response:', data);
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    
    req.on('error', (e) => {
      console.error('Request error:', e);
      reject(e);
    });
    
    req.end();
  });
}

checkDatabricksWorkspace().catch(console.error);
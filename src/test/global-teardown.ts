/**
 * Global Test Teardown
 * 
 * Ensures all services are properly cleaned up after test suites complete
 * to prevent Jest from hanging due to open handles.
 */

import { databricksService } from '../services/databricks.service';
import { redisService } from '../services/redis.service';

export default async (): Promise<void> => {
  console.log('🧹 Starting global test teardown...');
  
  const cleanupTasks: Promise<void>[] = [];
  
  // Clean up Databricks connections
  cleanupTasks.push(
    (async () => {
      try {
        await databricksService.disconnect();
        console.log('✅ Databricks service disconnected globally');
      } catch (error) {
        console.warn('⚠️ Error in global Databricks cleanup:', error);
      }
    })()
  );
  
  // Clean up Redis connections
  cleanupTasks.push(
    (async () => {
      try {
        if (redisService.isConnected()) {
          await redisService.disconnect();
          console.log('✅ Redis service disconnected globally');
        }
      } catch (error) {
        console.warn('⚠️ Error in global Redis cleanup:', error);
      }
    })()
  );
  
  // Wait for all cleanup tasks to complete
  await Promise.allSettled(cleanupTasks);
  
  // Give a brief moment for all async operations to complete
  await new Promise(resolve => setTimeout(resolve, 200));
  
  console.log('🧹 Global test teardown completed');
};

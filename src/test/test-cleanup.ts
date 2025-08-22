/**
 * Test Cleanup Utilities
 * 
 * Provides standardized cleanup functions for integration tests
 * to prevent Jest hanging issues.
 */

import { databricksService } from '../services/databricks.service';
import { redisService } from '../services/redis.service';

/**
 * Standard cleanup function for integration tests that use database services
 */
export const cleanupDatabaseServices = async (): Promise<void> => {
  const cleanupTasks: Promise<void>[] = [];
  
  // Cleanup Databricks service
  cleanupTasks.push(
    (async () => {
      try {
        await databricksService.disconnect();
        console.log('✅ Databricks service disconnected in test cleanup');
      } catch (error) {
        console.warn('⚠️ Error disconnecting Databricks in test:', error);
      }
    })()
  );
  
  // Cleanup Redis service if connected
  cleanupTasks.push(
    (async () => {
      try {
        if (redisService.isConnected()) {
          await redisService.disconnect();
          console.log('✅ Redis service disconnected in test cleanup');
        }
      } catch (error) {
        console.warn('⚠️ Error disconnecting Redis in test:', error);
      }
    })()
  );
  
  // Wait for all cleanup to complete
  await Promise.allSettled(cleanupTasks);
  
  // Brief delay to ensure cleanup completes
  await new Promise(resolve => setTimeout(resolve, 100));
};

/**
 * Enhanced afterAll hook that includes database cleanup
 */
export const afterAllWithCleanup = (serverCleanupFn?: () => Promise<void>) => {
  return async () => {
    // Custom server cleanup first if provided
    if (serverCleanupFn) {
      await serverCleanupFn();
    }
    
    // Standard database service cleanup
    await cleanupDatabaseServices();
  };
};

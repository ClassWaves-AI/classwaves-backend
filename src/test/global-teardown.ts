/**
 * Global Test Teardown
 * 
 * Ensures all services are properly cleaned up after test suites complete
 * to prevent Jest from hanging due to open handles.
 */

import { databricksService } from '../services/databricks.service';
import { redisService } from '../services/redis.service';
import * as promClient from 'prom-client';
import { closeNamespacedWebSocket } from '../services/websocket/namespaced-websocket.service';
import { logger } from '../utils/logger';

export default async (): Promise<void> => {
  logger.debug('🧹 Starting global test teardown...');
  
  const cleanupTasks: Promise<void>[] = [];
  
  // Clean up Databricks connections
  cleanupTasks.push(
    (async () => {
      try {
        await databricksService.disconnect();
        logger.debug('✅ Databricks service disconnected globally');
      } catch (error) {
        logger.warn('⚠️ Error in global Databricks cleanup:', error);
      }
    })()
  );
  
  // Clean up Redis connections
  cleanupTasks.push(
    (async () => {
      try {
        if (redisService.isConnected()) {
          await redisService.disconnect();
          logger.debug('✅ Redis service disconnected globally');
        }
      } catch (error) {
        logger.warn('⚠️ Error in global Redis cleanup:', error);
      }
    })()
  );
  
  // Wait for all cleanup tasks to complete
  await Promise.allSettled(cleanupTasks);

  // Close Socket.IO server if initialized
  try { await closeNamespacedWebSocket(); } catch (_error) { /* best effort: ignore failure */ }

  // Clear Prometheus registry to avoid open handles between workers
  try { promClient.register.clear(); } catch { /* intentionally ignored: best effort cleanup */ }
  
  // Give a brief moment for all async operations to complete
  await new Promise(resolve => setTimeout(resolve, 200));
  
  logger.debug('🧹 Global test teardown completed');
};

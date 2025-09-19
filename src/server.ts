import { createServer } from 'http';
import type { Socket } from 'net';
import app from './app';
import { serviceManager } from './services/service-manager';
import { initializeNamespacedWebSocket } from './services/websocket';
import { closeNamespacedWebSocket } from './services/websocket/namespaced-websocket.service';
import type { Worker as BullWorker } from 'bullmq';
import { healthController } from './controllers/health.controller';
import { logger } from './utils/logger';

// Robust port parsing to guard against malformed env (e.g., '3000DATABRICKS_...')
const envPort = process.env.PORT;
const parsedPort = envPort ? parseInt(envPort, 10) : NaN;
const PORT = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3000;

async function startServer() {
  try {
    // Initialize all services in proper dependency order
    const servicesInitialized = await serviceManager.initializeServices();
    const allowDegraded = process.env.NODE_ENV === 'test' || process.env.E2E_ALLOW_DEGRADED === '1';
    
    if (!servicesInitialized) {
      logger.error('❌ Critical services failed to initialize');
      if (!serviceManager.isHealthy()) {
        if (allowDegraded) {
          logger.warn('⚠️  Starting server with degraded functionality (test mode)');
        } else {
          logger.error('❌ Cannot start server without critical services');
          process.exit(1);
        }
      } else {
        logger.warn('⚠️  Starting server with partially initialized services');
      }
    }
    
    // Create HTTP server with debugging
    const httpServer = createServer(app);
    // Track open sockets so we can force-close on shutdown to avoid hangs
    const sockets = new Set<Socket>();
    httpServer.on('connection', (socket: Socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    
    // Optional debug: Log HTTP requests (enable with API_DEBUG=1)
    if (process.env.API_DEBUG === '1') {
      httpServer.on('request', (req, res) => {
        logger.debug('🔧 DEBUG: HTTP SERVER - Request received:', {
          method: req.method,
          url: req.url,
          headers: {
            'content-type': req.headers['content-type'],
            'content-length': req.headers['content-length'],
            'user-agent': req.headers['user-agent']
          }
        });
      });
    }
    
    // Initialize Namespaced WebSocket server (after Redis is ready)
    const wsService = initializeNamespacedWebSocket(httpServer);
    logger.debug('✅ Namespaced WebSocket server initialized');
    
    // Start HTTP server
    httpServer.listen(PORT, () => {
      logger.debug(`🚀 ClassWaves Backend Server running on port ${PORT}`);
      logger.debug(`📍 Environment: ${process.env.NODE_ENV}`);
      logger.debug(`🔗 Health check: http://localhost:${PORT}/api/v1/health`);
      logger.debug(`🔌 WebSocket endpoint: ws://localhost:${PORT}`);
      
      // Start periodic health monitoring
      healthController.startPeriodicHealthCheck();
      logger.debug('🏥 Periodic health monitoring started (5-minute intervals)');
      
      // Log final service health status
      if (serviceManager.isHealthy()) {
        logger.debug('✅ All critical services healthy');
      } else {
        logger.warn('⚠️  Server running with some services degraded');
      }
      // Initialize rate limiters now that services are up
      try {
        const { initializeRateLimiters } = require('./middleware/rate-limit.middleware');
        initializeRateLimiters()?.catch?.(() => undefined);
      } catch (_error) {
        // Best effort: rate limiter init failures are logged elsewhere and should not block startup.
      }

      // Optionally run STT worker inline in this process for dev convenience
      let sttWorker: BullWorker | undefined;
      try {
        if (String(process.env.STT_INLINE_WORKER || '0') === '1') {
          const { startAudioSttWorker } = require('./workers/audio-stt.worker');
          sttWorker = startAudioSttWorker();
          try { (global as any).sttWorker = sttWorker; } catch (_error) {
            // Non-fatal: global assignment is advisory for tests and can be safely ignored.
          }
          logger.debug('🎧 STT worker running inline with server (STT_INLINE_WORKER=1)');
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn('⚠️ Failed to start inline STT worker (non-blocking):', msg);
      }
    });

    // Graceful shutdown handling
    const graceful = async (signal: string) => {
      logger.debug(`🔄 Received ${signal}, shutting down gracefully...`);
      try { await closeNamespacedWebSocket(); } catch (_error) {
        // Ignore: shutdown proceeds even if websocket namespace was not initialized.
      }
      try { healthController.stopPeriodicHealthCheck(); } catch (_error) {
        // Ignore: health checks are best-effort and may already be stopped.
      }
      try {
        // Attempt to stop inline worker if present
        const anyGlobal: any = global as any;
        if (typeof (anyGlobal?.sttWorker?.close) === 'function') {
          await anyGlobal.sttWorker.close();
        }
      } catch (_error) {
        // Ignore: STT worker cleanup is best effort during shutdown.
      }
      try { await serviceManager.shutdown(); } catch (_error) {
        // Ignore: service manager handles partial shutdown internally.
      }
      try {
        // Destroy open sockets to allow httpServer.close callback to fire
        sockets.forEach((s) => {
          try {
            s.destroy();
          } catch (_socketError) {
            // Ignore: destroying an already closed socket is safe to skip.
          }
        });
      } catch (_error) {
        // Ignore: failing to destroy individual sockets should not block shutdown.
      }
      httpServer.close(() => {
        logger.debug('✅ Server shut down complete');
        process.exit(0);
      });
      // Fallback hard-exit if close hangs
      setTimeout(() => process.exit(0), 5000).unref();
    };

    process.on('SIGTERM', async () => {
      await graceful('SIGTERM');
    });

    process.on('SIGINT', async () => {
      await graceful('SIGINT');
    });

  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    await serviceManager.shutdown();
    process.exit(1);
  }
}

// Start the server
startServer();

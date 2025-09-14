import { createServer } from 'http';
import type { Socket } from 'net';
import app from './app';
import { serviceManager } from './services/service-manager';
import { initializeNamespacedWebSocket } from './services/websocket';
import { closeNamespacedWebSocket } from './services/websocket/namespaced-websocket.service';
import type { Worker as BullWorker } from 'bullmq';
import { healthController } from './controllers/health.controller';

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
      console.error('❌ Critical services failed to initialize');
      if (!serviceManager.isHealthy()) {
        if (allowDegraded) {
          console.warn('⚠️  Starting server with degraded functionality (test mode)');
        } else {
          console.error('❌ Cannot start server without critical services');
          process.exit(1);
        }
      } else {
        console.warn('⚠️  Starting server with partially initialized services');
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
        console.log('🔧 DEBUG: HTTP SERVER - Request received:', {
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
    console.log('✅ Namespaced WebSocket server initialized');
    
    // Start HTTP server
    httpServer.listen(PORT, () => {
      console.log(`🚀 ClassWaves Backend Server running on port ${PORT}`);
      console.log(`📍 Environment: ${process.env.NODE_ENV}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/api/v1/health`);
      console.log(`🔌 WebSocket endpoint: ws://localhost:${PORT}`);
      
      // Start periodic health monitoring
      healthController.startPeriodicHealthCheck();
      console.log('🏥 Periodic health monitoring started (5-minute intervals)');
      
      // Log final service health status
      if (serviceManager.isHealthy()) {
        console.log('✅ All critical services healthy');
      } else {
        console.warn('⚠️  Server running with some services degraded');
      }
      // Initialize rate limiters now that services are up
      try {
        const { initializeRateLimiters } = require('./middleware/rate-limit.middleware');
        initializeRateLimiters()?.catch?.(() => undefined);
      } catch {}

      // Optionally run STT worker inline in this process for dev convenience
      let sttWorker: BullWorker | undefined;
      try {
        if (String(process.env.STT_INLINE_WORKER || '0') === '1') {
          const { startAudioSttWorker } = require('./workers/audio-stt.worker');
          sttWorker = startAudioSttWorker();
          try { (global as any).sttWorker = sttWorker; } catch {}
          console.log('🎧 STT worker running inline with server (STT_INLINE_WORKER=1)');
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('⚠️ Failed to start inline STT worker (non-blocking):', msg);
      }
    });

    // Graceful shutdown handling
    const graceful = async (signal: string) => {
      console.log(`🔄 Received ${signal}, shutting down gracefully...`);
      try { await closeNamespacedWebSocket(); } catch {}
      try { healthController.stopPeriodicHealthCheck(); } catch {}
      try {
        // Attempt to stop inline worker if present
        const anyGlobal: any = global as any;
        if (typeof (anyGlobal?.sttWorker?.close) === 'function') {
          await anyGlobal.sttWorker.close();
        }
      } catch {}
      try { await serviceManager.shutdown(); } catch {}
      try {
        // Destroy open sockets to allow httpServer.close callback to fire
        sockets.forEach((s) => { try { s.destroy(); } catch {} });
      } catch {}
      httpServer.close(() => {
        console.log('✅ Server shut down complete');
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
    console.error('❌ Failed to start server:', error);
    await serviceManager.shutdown();
    process.exit(1);
  }
}

// Start the server
startServer();

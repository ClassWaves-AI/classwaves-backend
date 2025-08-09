import { createServer } from 'http';
import app from './app';
import { serviceManager } from './services/service-manager';
import { initializeWebSocket } from './services/websocket.service';

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
    
    // Create HTTP server
    const httpServer = createServer(app);
    
    // Initialize WebSocket server (after Redis is ready)
    const wsService = initializeWebSocket(httpServer);
    console.log('✅ WebSocket server initialized');
    
    // Start HTTP server
    httpServer.listen(PORT, () => {
      console.log(`🚀 ClassWaves Backend Server running on port ${PORT}`);
      console.log(`📍 Environment: ${process.env.NODE_ENV}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/api/v1/health`);
      console.log(`🔌 WebSocket endpoint: ws://localhost:${PORT}`);
      
      // Log final service health status
      if (serviceManager.isHealthy()) {
        console.log('✅ All critical services healthy');
      } else {
        console.warn('⚠️  Server running with some services degraded');
      }
    });

    // Graceful shutdown handling
    process.on('SIGTERM', async () => {
      console.log('🔄 Received SIGTERM, shutting down gracefully...');
      await serviceManager.shutdown();
      httpServer.close(() => {
        console.log('✅ Server shut down complete');
        process.exit(0);
      });
    });

    process.on('SIGINT', async () => {
      console.log('🔄 Received SIGINT, shutting down gracefully...');
      await serviceManager.shutdown();
      httpServer.close(() => {
        console.log('✅ Server shut down complete');
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    await serviceManager.shutdown();
    process.exit(1);
  }
}

// Start the server
startServer();
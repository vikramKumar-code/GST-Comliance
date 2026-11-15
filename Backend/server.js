const mongoose = require('mongoose');
// Reload env: ALLOW_DEV_LIVE_FILING enabled
const cluster = require('cluster'); // ✅ NEW: Multi-process support
const os = require('os');
const app = require('./src/app');
const connectDB = require('./src/config/mongo');
const { PORT, TRUST_PROXY_HOPS, NODE_ENV } = require('./src/config/env');
const logger = require('./src/utils/logger');

let server;
let isShuttingDown = false;

// ✅ NEW: Configuration
const SERVER_CONFIG = {
  shutdownTimeout: 10000, // 10 seconds for graceful shutdown
  startupTimeout: 30000, // 30 seconds for startup
  enableCluster: process.env.ENABLE_CLUSTER === 'true' && NODE_ENV === 'production',
  numWorkers: process.env.WEB_CONCURRENCY || os.cpus().length
};

/**
 * Start the Express server with health check
 */
async function startServer() {
  const startTime = Date.now();

  try {
    // ✅ FIX 4: Connect to MongoDB with retry logic
    await connectDB();

    // Wait for MongoDB to be ready
    await waitForMongoDB(SERVER_CONFIG.startupTimeout);

    // Start HTTP server
    server = app.listen(PORT, () => {
      const startupTime = Date.now() - startTime;
      logger.info('Application listening', {
        port: PORT,
        trustedProxyHops: TRUST_PROXY_HOPS,
        startupTimeMs: startupTime,
        nodeEnv: NODE_ENV,
        pid: process.pid
      });
    });

    // Configure server timeouts (120s for GST portal returns filing & heavy Excel imports)
    server.timeout = 120000; // 120 seconds for request processing
    server.keepAliveTimeout = 125000; // 125 seconds (longer than timeout)
    server.headersTimeout = 126000; // 126 seconds (longer than keepAliveTimeout)

    return server;
  } catch (error) {
    logger.error('Application startup failed', {
      name: error.name,
      code: error.code,
      message: error.message,
      stack: NODE_ENV === 'development' ? error.stack : undefined
    });
    throw error;
  }
}

/**
 * Wait for MongoDB connection to be ready
 */
async function waitForMongoDB(timeoutMs) {
  const startTime = Date.now();

  while (mongoose.connection.readyState !== 1) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`MongoDB connection timeout after ${timeoutMs}ms`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  logger.info('MongoDB connection ready', {
    readyState: mongoose.connection.readyState
  });
}

/**
 * Graceful shutdown with timeout
 */
async function stopServer(signal) {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress', { signal });
    return;
  }

  isShuttingDown = true;
  logger.info('Shutting down application', { signal, pid: process.pid });

  // ✅ FIX 1: Force close after timeout
  const shutdownPromise = new Promise(async (resolve) => {
    if (server) {
      logger.info('Closing HTTP server...');

      // Stop accepting new connections
      server.close((err) => {
        if (err) {
          logger.error('Error closing server', { error: err.message });
        } else {
          logger.info('HTTP server closed gracefully');
        }
        resolve();
      });

      // Force close existing connections
      if (server.connections) {
        Object.values(server.connections).forEach((conn) => {
          conn.destroy();
        });
      }
    } else {
      resolve();
    }
  });

  // Timeout for graceful shutdown
  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => {
      logger.warn('Shutdown timeout reached, forcing exit', {
        timeout: SERVER_CONFIG.shutdownTimeout
      });
      resolve();
    }, SERVER_CONFIG.shutdownTimeout);
  });

  await Promise.race([shutdownPromise, timeoutPromise]);

  // ✅ FIX 3: MongoDB disconnect with error handling
  try {
    if (mongoose.connection.readyState !== 0) {
      logger.info('Disconnecting from MongoDB...');
      await mongoose.disconnect();
      logger.info('MongoDB disconnected');
    }
  } catch (error) {
    logger.error('Error disconnecting MongoDB', { error: error.message });
  }

  logger.info('Shutdown complete', { signal });
}

/**
 * ✅ NEW: Cluster mode for multi-process support
 */
async function startCluster() {
  if (cluster.isPrimary) {
    logger.info(`Primary ${process.pid} is running`);
    logger.info(`Forking ${SERVER_CONFIG.numWorkers} workers...`);

    for (let i = 0; i < SERVER_CONFIG.numWorkers; i++) {
      cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
      logger.warn(`Worker ${worker.process.pid} died`, { code, signal });

      // Restart worker if it crashed (not during shutdown)
      if (!isShuttingDown) {
        logger.info('Starting a new worker...');
        cluster.fork();
      }
    });

    // Handle shutdown signals in primary
    process.once('SIGTERM', () => {
      logger.info('Primary received SIGTERM, shutting down workers...');
      isShuttingDown = true;

      Object.values(cluster.workers).forEach((worker) => {
        if (worker) {
          worker.process.kill('SIGTERM');
        }
      });

      setTimeout(() => {
        logger.info('Primary exiting');
        process.exit(0);
      }, SERVER_CONFIG.shutdownTimeout);
    });

    process.once('SIGINT', () => {
      logger.info('Primary received SIGINT, shutting down workers...');
      isShuttingDown = true;

      Object.values(cluster.workers).forEach((worker) => {
        if (worker) {
          worker.process.kill('SIGINT');
        }
      });

      setTimeout(() => {
        logger.info('Primary exiting');
        process.exit(0);
      }, SERVER_CONFIG.shutdownTimeout);
    });
  } else {
    // Worker process
    logger.info(`Worker ${process.pid} started`);

    await startServer();

    process.once('SIGTERM', () => stopServer('SIGTERM').finally(() => process.exit(0)));
    process.once('SIGINT', () => stopServer('SIGINT').finally(() => process.exit(0)));
  }
}

// ✅ FIX 2: Global error handlers
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', {
    error: error.message,
    stack: error.stack,
    pid: process.pid
  });

  // Give time to log, then exit
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
    pid: process.pid
  });

  // In production, exit on unhandled rejections
  if (NODE_ENV === 'production') {
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  }
});

// Main entry point
if (require.main === module) {
  (async () => {
    try {
      if (SERVER_CONFIG.enableCluster) {
        await startCluster();
      } else {
        await startServer();

        process.once('SIGTERM', () => stopServer('SIGTERM').finally(() => process.exit(0)));
        process.once('SIGINT', () => stopServer('SIGINT').finally(() => process.exit(0)));
      }
    } catch (error) {
      logger.error('Fatal error during startup', {
        error: error.message,
        stack: error.stack
      });
      process.exit(1);
    }
  })();
}

// Export for testing
module.exports = {
  startServer,
  stopServer,
  SERVER_CONFIG
};
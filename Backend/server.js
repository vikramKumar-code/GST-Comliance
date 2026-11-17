'use strict';

/*
 * When server.js is the process entrypoint, it should own graceful shutdown.
 * app.js also contains shutdown handlers, so disable them unless explicitly
 * configured otherwise.
 *
 * If you want app.js to own shutdown, set:
 *   ENABLE_APP_SHUTDOWN_HANDLERS=true
 * and avoid starting through server.js cluster/entrypoint handlers.
 */
if (process.env.ENABLE_APP_SHUTDOWN_HANDLERS === undefined) {
  process.env.ENABLE_APP_SHUTDOWN_HANDLERS = 'false';
}

const http = require('http');
const mongoose = require('mongoose');
const cluster = require('cluster');
const os = require('os');

const app = require('./src/app');
const connectDB = require('./src/config/mongo');
const { PORT, TRUST_PROXY_HOPS, NODE_ENV } = require('./src/config/env');
const logger = require('./src/utils/logger');

let server;
let isShuttingDown = false;

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

function positiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function nonNegativeInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

const HOST = process.env.HOST || '0.0.0.0';
const PORT_NUMBER = nonNegativeInt(PORT, 3000);

const SHUTDOWN_TIMEOUT_MS = positiveInt(
  process.env.GST_SHUTDOWN_TIMEOUT_MS,
  10000
);

const STARTUP_TIMEOUT_MS = positiveInt(
  process.env.GST_STARTUP_TIMEOUT_MS,
  30000
);

const REQUEST_TIMEOUT_MS = positiveInt(
  process.env.GST_REQUEST_TIMEOUT_MS,
  120000
);

const CPU_COUNT = Math.max(1, os.cpus()?.length || 1);

const NUM_WORKERS = Math.min(
  positiveInt(process.env.WEB_CONCURRENCY, CPU_COUNT),
  CPU_COUNT
);

const ALLOW_CLUSTER_NON_PROD =
  String(process.env.ALLOW_CLUSTER_NON_PROD || 'false').toLowerCase() === 'true';

const ENABLE_CLUSTER =
  String(process.env.ENABLE_CLUSTER || 'false').toLowerCase() === 'true' &&
  (NODE_ENV === 'production' || ALLOW_CLUSTER_NON_PROD);

const SERVER_CONFIG = {
  host: HOST,
  port: PORT_NUMBER,
  shutdownTimeout: SHUTDOWN_TIMEOUT_MS,
  startupTimeout: STARTUP_TIMEOUT_MS,
  requestTimeout: REQUEST_TIMEOUT_MS,
  enableCluster: ENABLE_CLUSTER,
  numWorkers: NUM_WORKERS
};

/* -------------------------------------------------------------------------- */
/* Socket tracking for graceful close                                         */
/* -------------------------------------------------------------------------- */

const trackedSockets = new Set();

function trackSocket(socket) {
  if (!socket) return;

  trackedSockets.add(socket);

  const cleanup = () => {
    trackedSockets.delete(socket);
  };

  socket.on('close', cleanup);
  socket.on('error', cleanup);
}

function destroyTrackedSockets() {
  for (const socket of trackedSockets) {
    try {
      socket.destroy();
    } catch (_) {
      // Ignore destroy errors during shutdown.
    }
  }

  trackedSockets.clear();
}

/* -------------------------------------------------------------------------- */
/* MongoDB readiness                                                          */
/* -------------------------------------------------------------------------- */

function waitForMongoDB(timeoutMs) {
  return new Promise((resolve, reject) => {
    if (mongoose.connection.readyState === 1) {
      return resolve();
    }

    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;

      settled = true;
      cleanup();
      reject(new Error(`MongoDB connection timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    const onConnected = () => {
      if (settled) return;

      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve();
    };

    function cleanup() {
      mongoose.connection.removeListener('connected', onConnected);
    }

    mongoose.connection.once('connected', onConnected);
  });
}

/* -------------------------------------------------------------------------- */
/* Start HTTP server                                                          */
/* -------------------------------------------------------------------------- */

async function startServer() {
  const startTime = Date.now();

  try {
    await connectDB();
    await waitForMongoDB(SERVER_CONFIG.startupTimeout);

    server = http.createServer(app);

    /**
     * Prefer app-level timeout configuration so HTTP server timeouts stay
     * aligned with Express request timeout middleware.
     */
    if (typeof app.configureServerTimeouts === 'function') {
      app.configureServerTimeouts(server);
    } else {
      // Fallback for older app.js versions.
      server.timeout = SERVER_CONFIG.requestTimeout;
      server.requestTimeout = SERVER_CONFIG.requestTimeout + 15000;
      server.headersTimeout = SERVER_CONFIG.requestTimeout + 10000;
      server.keepAliveTimeout = 65000;
    }

    server.on('connection', trackSocket);

    server.on('error', (err) => {
      logger.error('HTTP server error', {
        code: err?.code,
        message: err?.message,
        pid: process.pid
      });
    });

    await new Promise((resolve, reject) => {
      const onError = (err) => {
        server.removeListener('listening', onListening);
        reject(err);
      };

      const onListening = () => {
        server.removeListener('error', onError);
        resolve();
      };

      server.once('error', onError);
      server.once('listening', onListening);

      server.listen(SERVER_CONFIG.port, SERVER_CONFIG.host);
    });

    logger.info('Application listening', {
      host: SERVER_CONFIG.host,
      port: SERVER_CONFIG.port,
      nodeEnv: NODE_ENV,
      pid: process.pid,
      ppid: process.ppid,
      trustedProxyHops: TRUST_PROXY_HOPS,
      requestTimeoutMs: SERVER_CONFIG.requestTimeout,
      startupTimeMs: Date.now() - startTime
    });

    return server;
  } catch (error) {
    logger.error('Application startup failed', {
      name: error?.name,
      code: error?.code,
      message: error?.message,
      stack: NODE_ENV === 'development' ? error?.stack : undefined,
      pid: process.pid
    });

    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Graceful shutdown                                                          */
/* -------------------------------------------------------------------------- */

async function stopServer(signal) {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress', {
      signal,
      pid: process.pid
    });
    return;
  }

  isShuttingDown = true;

  logger.info('Shutting down application', {
    signal,
    pid: process.pid
  });

  const forceTimer = setTimeout(() => {
    logger.warn('Shutdown timeout reached, destroying remaining connections', {
      timeoutMs: SERVER_CONFIG.shutdownTimeout,
      pid: process.pid
    });

    destroyTrackedSockets();
  }, SERVER_CONFIG.shutdownTimeout);

  try {
    if (server) {
      logger.info('Closing HTTP server...', { pid: process.pid });

      await new Promise((resolve) => {
        server.close((err) => {
          if (err) {
            logger.error('Error closing HTTP server', {
              code: err?.code,
              message: err?.message,
              pid: process.pid
            });
          } else {
            logger.info('HTTP server closed gracefully', {
              pid: process.pid
            });
          }

          resolve();
        });
      });
    }
  } finally {
    clearTimeout(forceTimer);
    destroyTrackedSockets();
  }

  try {
    if (mongoose.connection.readyState !== 0) {
      logger.info('Disconnecting from MongoDB...', { pid: process.pid });
      await mongoose.disconnect();
      logger.info('MongoDB disconnected', { pid: process.pid });
    }
  } catch (error) {
    logger.error('Error disconnecting MongoDB', {
      message: error?.message,
      pid: process.pid
    });
  }

  logger.info('Shutdown complete', {
    signal,
    pid: process.pid
  });
}

/* -------------------------------------------------------------------------- */
/* Cluster support                                                            */
/* -------------------------------------------------------------------------- */

async function startCluster() {
  const isPrimary =
    typeof cluster.isPrimary === 'boolean'
      ? cluster.isPrimary
      : cluster.isMaster;

  if (isPrimary) {
    logger.info('Primary process starting cluster', {
      pid: process.pid,
      workers: SERVER_CONFIG.numWorkers,
      nodeEnv: NODE_ENV
    });

    const activeWorkers = new Set();

    let resolveAllExited = null;
    const allWorkersExited = new Promise((resolve) => {
      resolveAllExited = resolve;
    });

    const checkAllExited = () => {
      if (isShuttingDown && activeWorkers.size === 0 && resolveAllExited) {
        resolveAllExited();
        resolveAllExited = null;
      }
    };

    cluster.on('exit', (worker, code, signal) => {
      activeWorkers.delete(worker.id);

      logger.warn('Worker exited', {
        workerId: worker.id,
        pid: worker.process?.pid,
        code,
        signal,
        primaryPid: process.pid
      });

      if (!isShuttingDown) {
        logger.info('Restarting worker after unexpected exit', {
          primaryPid: process.pid
        });

        const restarted = cluster.fork();
        if (restarted) {
          activeWorkers.add(restarted.id);
        }
      } else {
        checkAllExited();
      }
    });

    for (let i = 0; i < SERVER_CONFIG.numWorkers; i += 1) {
      const worker = cluster.fork();

      if (worker) {
        activeWorkers.add(worker.id);
      }
    }

    const shutdownPrimary = async (signal) => {
      if (isShuttingDown) return;

      isShuttingDown = true;

      logger.info('Primary received shutdown signal', {
        signal,
        pid: process.pid,
        activeWorkers: activeWorkers.size
      });

      for (const id of Array.from(activeWorkers)) {
        const worker = cluster.workers[id];

        if (!worker || !worker.process) continue;

        try {
          if (!worker.process.killed) {
            worker.process.kill('SIGTERM');
          }
        } catch (err) {
          logger.warn('Failed to signal worker during shutdown', {
            workerId: id,
            pid: worker.process?.pid,
            message: err?.message
          });
        }
      }

      checkAllExited();

      const forceExitTimer = setTimeout(() => {
        logger.warn('Primary shutdown timeout reached, forcing exit', {
          remainingWorkers: activeWorkers.size,
          pid: process.pid
        });

        process.exit(0);
      }, SERVER_CONFIG.shutdownTimeout + 5000);

      try {
        await allWorkersExited;
      } finally {
        clearTimeout(forceExitTimer);
      }

      logger.info('All workers exited, primary exiting', {
        pid: process.pid
      });

      process.exit(0);
    };

    process.once('SIGTERM', () => {
      shutdownPrimary('SIGTERM').catch((err) => {
        logger.error('Primary shutdown error', {
          message: err?.message,
          pid: process.pid
        });

        process.exit(1);
      });
    });

    process.once('SIGINT', () => {
      shutdownPrimary('SIGINT').catch((err) => {
        logger.error('Primary shutdown error', {
          message: err?.message,
          pid: process.pid
        });

        process.exit(1);
      });
    });

    return;
  }

  /* ------------------------------------------------------------------------ */
  /* Worker process                                                           */
  /* ------------------------------------------------------------------------ */

  logger.info('Cluster worker started', {
    pid: process.pid,
    ppid: process.ppid
  });

  try {
    await startServer();
  } catch (error) {
    logger.error('Worker startup failed', {
      pid: process.pid,
      message: error?.message,
      code: error?.code
    });

    await stopServer('WORKER_STARTUP_FAILED').catch(() => { });
    process.exit(1);
  }

  const shutdownWorker = (signal) => {
    stopServer(signal)
      .then(() => process.exit(0))
      .catch((err) => {
        logger.error('Worker shutdown error', {
          signal,
          pid: process.pid,
          message: err?.message
        });

        process.exit(1);
      });
  };

  process.once('SIGTERM', () => shutdownWorker('SIGTERM'));
  process.once('SIGINT', () => shutdownWorker('SIGINT'));
}

/* -------------------------------------------------------------------------- */
/* Optional process error handlers                                            */
/*                                                                            */
/* app.js already registers uncaughtException / unhandledRejection handlers.  */
/* Keep these disabled by default to avoid duplicate handlers.                */
/*                                                                            */
/* If you remove process handlers from app.js and want server.js to own them, */
/* set:                                                                       */
/*   ENABLE_SERVER_PROCESS_HANDLERS=true                                      */
/* -------------------------------------------------------------------------- */

if (
  String(process.env.ENABLE_SERVER_PROCESS_HANDLERS || 'false').toLowerCase() ===
  'true' &&
  !global.__GST_SERVER_PROCESS_HANDLERS__
) {
  global.__GST_SERVER_PROCESS_HANDLERS__ = true;

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', {
      message: error?.message,
      stack: error?.stack,
      pid: process.pid
    });

    stopServer('UNCAUGHT_EXCEPTION')
      .catch(() => { })
      .finally(() => {
        setTimeout(() => process.exit(1), 1000);
      });
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Rejection', {
      reason: reason instanceof Error ? reason.message : String(reason || 'unknown'),
      stack: reason instanceof Error ? reason.stack : undefined,
      pid: process.pid
    });

    if (NODE_ENV === 'production') {
      stopServer('UNHANDLED_REJECTION')
        .catch(() => { })
        .finally(() => {
          setTimeout(() => process.exit(1), 1000);
        });
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Main entrypoint                                                            */
/* -------------------------------------------------------------------------- */

if (require.main === module) {
  (async () => {
    try {
      if (SERVER_CONFIG.enableCluster) {
        await startCluster();
      } else {
        await startServer();

        const shutdown = (signal) => {
          stopServer(signal)
            .then(() => process.exit(0))
            .catch((err) => {
              logger.error('Shutdown error', {
                signal,
                pid: process.pid,
                message: err?.message
              });

              process.exit(1);
            });
        };

        process.once('SIGTERM', () => shutdown('SIGTERM'));
        process.once('SIGINT', () => shutdown('SIGINT'));
      }
    } catch (error) {
      logger.error('Fatal error during startup', {
        message: error?.message,
        code: error?.code,
        stack: NODE_ENV === 'development' ? error?.stack : undefined,
        pid: process.pid
      });

      await stopServer('FATAL_STARTUP').catch(() => { });
      process.exit(1);
    }
  })();
}

/* -------------------------------------------------------------------------- */
/* Exports for tests / programmatic usage                                     */
/* -------------------------------------------------------------------------- */

module.exports = {
  startServer,
  stopServer,
  startCluster,
  SERVER_CONFIG,
  getServer: () => server,
  isShuttingDown: () => isShuttingDown
};
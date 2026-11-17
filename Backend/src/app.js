const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const morgan = require('morgan');
const timeout = require('connect-timeout');
const mongoose = require('mongoose');

const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const { FRONTEND_URL, NODE_ENV, TRUST_PROXY_HOPS } = require('./config/env');
const { apiLimiter } = require('./middleware/rateLimit');
const ApiError = require('./utils/apiError');
const logger = require('./utils/logger');

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

const BODY_LIMIT = process.env.HTTP_BODY_LIMIT || '10mb';
const PARAMETER_LIMIT = Math.max(
  1000,
  Number(process.env.HTTP_PARAMETER_LIMIT || 5000)
);

const REQUEST_TIMEOUT_MS = Math.max(
  5000,
  Number(process.env.GST_REQUEST_TIMEOUT_MS || 120000)
);

const ENABLE_APP_SHUTDOWN_HANDLERS =
  String(process.env.ENABLE_APP_SHUTDOWN_HANDLERS || 'true').toLowerCase() !== 'false';

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const SENSITIVE_QUERY_KEYS = new Set([
  'token',
  'gsttoken',
  'authtoken',
  'auth-token',
  'password',
  'passwd',
  'secret',
  'clientsecret',
  'client_secret',
  'refresh_token',
  'access_token',
  'otp',
  'evc',
  'pan',
  'sid',
  'sign',
  'signature',
  'aspid',
  'arn'
]);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveTrustProxy(value) {
  if (value === undefined || value === null || value === '') return false;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value;

  const raw = String(value).trim();

  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw.toLowerCase() === 'true') return true;
  if (raw.toLowerCase() === 'false') return false;

  return raw;
}

function sendSafeJson(res, status, body) {
  if (res.headersSent) {
    logger.warn('Response already sent — skipping duplicate response', {
      status,
      url: res.req?.originalUrl || res.req?.url
    });
    return;
  }

  res.status(status).json(body);
}

function sanitizeUrl(originalUrl) {
  if (!originalUrl) return '';

  try {
    const url = new URL(originalUrl, 'http://internal');

    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }

    return `${url.pathname}${url.search}`;
  } catch {
    const [path] = String(originalUrl).split('?');
    return path || '';
  }
}

function sanitizeJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeJsonValue);
  }

  if (isPlainObject(value)) {
    const clean = {};

    for (const key of Object.keys(value)) {
      if (UNSAFE_KEYS.has(key)) continue;
      clean[key] = sanitizeJsonValue(value[key]);
    }

    return clean;
  }

  return value;
}

function jsonReviver(key, value) {
  if (UNSAFE_KEYS.has(key)) return undefined;
  return sanitizeJsonValue(value);
}

function getDbStateName(state) {
  switch (state) {
    case 0: return 'disconnected';
    case 1: return 'connected';
    case 2: return 'connecting';
    case 3: return 'disconnecting';
    default: return 'unknown';
  }
}

function getMemoryMb(bytes) {
  return Math.round(bytes / 1024 / 1024);
}

function parseAdditionalOrigins(value) {
  if (!value) return [];

  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/* App                                                                        */
/* -------------------------------------------------------------------------- */

const app = express();

// Trust only the explicitly configured number of reverse-proxy hops.
app.set('trust proxy', resolveTrustProxy(TRUST_PROXY_HOPS));
app.disable('x-powered-by');

/* -------------------------------------------------------------------------- */
/* Request ID                                                                 */
/* -------------------------------------------------------------------------- */

app.use((req, res, next) => {
  const incoming =
    req.get('X-Request-Id') ||
    req.get('X-Amzn-Trace-Id') ||
    null;

  const requestId = incoming && String(incoming).trim()
    ? String(incoming).trim()
    : crypto.randomUUID();

  req.requestId = requestId;
  res.setRequestId?.(requestId);
  res.setHeader('X-Request-Id', requestId);

  // Optional: expose to downstream middleware/controllers.
  req.log = req.log || logger;

  next();
});

/* -------------------------------------------------------------------------- */
/* Request logging                                                            */
/* -------------------------------------------------------------------------- */

morgan.token('sanitized-url', (req) => sanitizeUrl(req.originalUrl || req.url));
morgan.token('request-id', (req, res) => {
  return (
    res.getHeader('X-Request-Id') ||
    req.requestId ||
    '-'
  );
});

const morganFormat =
  ':remote-addr - :remote-user [:date[clf]] ' +
  '":method :sanitized-url HTTP/:http-version" ' +
  ':status :res[content-length] ' +
  '":referrer" ":user-agent" ' +
  'rt=:response-time rid=:request-id';

app.use(
  morgan(morganFormat, {
    stream: {
      write: (message) => logger.info(message.trim())
    },
    skip: (req, res) => {
      // Reduce noise from frequent health probes.
      return req.path === '/health' && res.statusCode === 200;
    }
  })
);

/* -------------------------------------------------------------------------- */
/* Security headers                                                           */
/* -------------------------------------------------------------------------- */

app.use(
  helmet({
    contentSecurityPolicy: NODE_ENV === 'production' ? undefined : false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    frameguard: { action: 'deny' }
  })
);

/* -------------------------------------------------------------------------- */
/* CORS                                                                       */
/* -------------------------------------------------------------------------- */

const additionalOrigins = parseAdditionalOrigins(process.env.EXTRA_CORS_ORIGINS);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests without Origin (server-to-server, Postman, curl).
      if (!origin) {
        return callback(null, true);
      }

      // Allow configured frontend URL.
      if (FRONTEND_URL && origin === FRONTEND_URL) {
        return callback(null, true);
      }

      // Allow explicit additional origins.
      if (additionalOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Allow localhost in development.
      if (
        NODE_ENV !== 'production' &&
        /^http:\/\/localhost:\d+$/.test(origin)
      ) {
        return callback(null, true);
      }

      logger.warn('[CORS] Blocked request from unauthorized origin', {
        origin,
        requestId: origin ? undefined : undefined
      });

      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'x-workspace-id',
      'x-gstin',
      'X-Idempotency-Key',
      'X-Request-Id',
      'Accept',
      'Accept-Language'
    ],
    exposedHeaders: [
      'X-Request-Id',
      'Content-Disposition'
    ],
    maxAge: 86400 // 24 hours preflight cache
  })
);

/* -------------------------------------------------------------------------- */
/* Compression                                                                */
/* -------------------------------------------------------------------------- */

app.use(
  compression({
    filter: (req, res) => {
      if (req.headers['x-no-compression']) {
        return false;
      }

      // Avoid compressing streams/SSE if ever added.
      const type = res.getHeader('Content-Type');
      if (typeof type === 'string' && type.includes('text/event-stream')) {
        return false;
      }

      return compression.filter(req, res);
    },
    level: 6
  })
);

/* -------------------------------------------------------------------------- */
/* Body parsers                                                               */
/* -------------------------------------------------------------------------- */

app.use(
  express.json({
    limit: BODY_LIMIT,
    strict: true,
    reviver: jsonReviver
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: BODY_LIMIT,
    parameterLimit: PARAMETER_LIMIT,
    charset: 'utf-8'
  })
);

app.use(cookieParser());

/* -------------------------------------------------------------------------- */
/* Request timeout                                                            */
/* -------------------------------------------------------------------------- */

app.use(timeout(REQUEST_TIMEOUT_MS));

app.use((req, res, next) => {
  const finishTimeout = () => {
    if (res.headersSent) return;

    logger.warn('[Timeout] Request timed out', {
      requestId: req.requestId,
      method: req.method,
      url: sanitizeUrl(req.originalUrl || req.url),
      timeoutMs: REQUEST_TIMEOUT_MS
    });

    sendSafeJson(res, 504, {
      success: false,
      code: 'REQUEST_TIMEOUT',
      message:
        'The request took too long to complete. Please try again after some time.',
      requestId: req.requestId
    });
  };

  if (req.timedout) {
    finishTimeout();
    return;
  }

  req.on('timeout', finishTimeout);

  next();
});

/* -------------------------------------------------------------------------- */
/* Health check                                                               */
/* -------------------------------------------------------------------------- */

app.get('/health', (req, res) => {
  const dbState = mongoose.connection.readyState;
  const isDbConnected = dbState === 1;
  const memoryUsage = process.memoryUsage();

  sendSafeJson(res, isDbConnected ? 200 : 503, {
    status: isDbConnected ? 'healthy' : 'degraded',
    database: getDbStateName(dbState),
    uptimeSeconds: Math.floor(process.uptime()),
    memory: {
      rssMb: getMemoryMb(memoryUsage.rss),
      heapUsedMb: getMemoryMb(memoryUsage.heapUsed),
      heapTotalMb: getMemoryMb(memoryUsage.heapTotal)
    },
    requestId: req.requestId,
    timestamp: new Date().toISOString()
  });
});

/* -------------------------------------------------------------------------- */
/* API routes                                                                 */
/* -------------------------------------------------------------------------- */

app.use('/api', apiLimiter, routes);

/* -------------------------------------------------------------------------- */
/* 404                                                                        */
/* -------------------------------------------------------------------------- */

app.use((req, res) => {
  sendSafeJson(res, 404, {
    success: false,
    code: 'NOT_FOUND',
    message: `Route ${req.method} ${sanitizeUrl(req.originalUrl || req.url)} not found`,
    requestId: req.requestId
  });
});

/* -------------------------------------------------------------------------- */
/* Centralized error handler                                                  */
/* -------------------------------------------------------------------------- */

app.use(errorHandler);

/* -------------------------------------------------------------------------- */
/* Mongoose connection observability                                         */
/* -------------------------------------------------------------------------- */

mongoose.connection.on('connected', () => {
  logger.info('[MongoDB] Connected');
});

mongoose.connection.on('error', (err) => {
  logger.error('[MongoDB] Connection error', {
    message: err?.message || 'unknown'
  });
});

mongoose.connection.on('disconnected', () => {
  logger.warn('[MongoDB] Disconnected');
});

mongoose.connection.on('reconnected', () => {
  logger.info('[MongoDB] Reconnected');
});

/* -------------------------------------------------------------------------- */
/* Process-level safety                                                       */
/* -------------------------------------------------------------------------- */

if (NODE_ENV !== 'test') {
  process.on('unhandledRejection', (reason) => {
    logger.error('[Process] Unhandled rejection', {
      reason:
        reason instanceof Error
          ? reason.message
          : String(reason || 'unknown')
    });
  });

  process.on('uncaughtException', (err) => {
    logger.error('[Process] Uncaught exception', {
      message: err?.message || 'unknown',
      stack: err?.stack
    });

    // In production, fail fast after logging.
    if (NODE_ENV === 'production') {
      setTimeout(() => process.exit(1), 1000);
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Graceful shutdown                                                          */
/* -------------------------------------------------------------------------- */

function registerGracefulShutdown() {
  if (global.__GST_APP_SHUTDOWN_REGISTERED__) return;
  global.__GST_APP_SHUTDOWN_REGISTERED__ = true;

  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`[App] ${signal} received, shutting down gracefully...`);

    const forceExitTimer = setTimeout(() => {
      logger.error('[App] Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10000);

    try {
      mongoose.connection.close(false, () => {
        clearTimeout(forceExitTimer);
        logger.info('[App] MongoDB connection closed');
        process.exit(0);
      });
    } catch (err) {
      clearTimeout(forceExitTimer);
      logger.error('[App] Error during MongoDB close', {
        message: err?.message || 'unknown'
      });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (
  NODE_ENV !== 'test' &&
  ENABLE_APP_SHUTDOWN_HANDLERS
) {
  registerGracefulShutdown();
}

/* -------------------------------------------------------------------------- */
/* Server timeout helper                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Use from server.js:
 *
 * const app = require('./app');
 * const server = http.createServer(app);
 * app.configureServerTimeouts(server);
 *
 * This keeps Node HTTP server timeouts compatible with long GSTN polling flows.
 */
app.configureServerTimeouts = function configureServerTimeouts(server) {
  if (!server) return server;

  // HTTP server request timeout should be slightly larger than app request timeout.
  server.requestTimeout = REQUEST_TIMEOUT_MS + 15000;
  server.headersTimeout = REQUEST_TIMEOUT_MS + 10000;
  server.keepAliveTimeout = 65000;
  server.timeout = REQUEST_TIMEOUT_MS + 20000;

  return server;
};

module.exports = app;
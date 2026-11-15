const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const compression = require('compression'); // ✅ NEW: Response compression
const morgan = require('morgan'); // ✅ NEW: Request logging
const timeout = require('connect-timeout'); // ✅ NEW: Request timeout
const mongoose = require('mongoose');

const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const { FRONTEND_URL, NODE_ENV, TRUST_PROXY_HOPS } = require('./config/env');
const { apiLimiter } = require('./middleware/rateLimit');
const ApiError = require('./utils/apiError');
const logger = require('./utils/logger');

const app = express();

// Trust only the explicitly configured number of reverse-proxy hops
app.set('trust proxy', TRUST_PROXY_HOPS);

// ✅ FIX 5: Request logging (structured logs for debugging)
if (NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', {
    stream: { write: (message) => logger.info(message.trim()) }
  }));
}

// Security Headers
app.use(helmet({
  contentSecurityPolicy: NODE_ENV === 'production' ? undefined : false, // Disable CSP in dev
  crossOriginEmbedderPolicy: false // Allow external resources if needed
}));

// ✅ FIX 2: Consolidated CORS configuration (removed redundant middleware)
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests without Origin (server-to-server, Postman, curl)
      if (!origin) {
        return callback(null, true);
      }

      // Allow configured frontend URL
      if (origin === FRONTEND_URL) {
        return callback(null, true);
      }

      // Allow localhost in development
      if (NODE_ENV !== 'production' && /^http:\/\/localhost:\d+$/.test(origin)) {
        return callback(null, true);
      }

      // Reject all other origins
      logger.warn('[CORS] Blocked request from unauthorized origin', { origin });
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-workspace-id'],
    maxAge: 86400 // 24 hours (preflight cache)
  })
);

// ✅ FIX 5: Response compression (improves performance on slow networks)
app.use(compression({
  filter: (req, res) => {
    // Don't compress responses if client doesn't support it
    if (req.headers['x-no-compression']) {
      return false;
    }
    // Use default compression filter
    return compression.filter(req, res);
  },
  level: 6 // Balanced compression (1=fastest, 9=best compression)
}));

// Body parsers & Cookie parser
// ✅ FIX: 10mb limit for bulk Excel/CSV imports, GSTR-1 payloads, and returns data
app.use(express.json({
  limit: '10mb',
  strict: true // Security: Prevent prototype pollution
}));
app.use(express.urlencoded({
  extended: true,
  limit: '10mb',
  parameterLimit: 5000
}));
app.use(cookieParser());

// ✅ FIX: 120 second timeout for GST return filings, portal communication & heavy Excel imports
app.use(timeout('120s'));
app.use((req, res, next) => {
  if (!req.timedout) {
    next();
  }
});

// Health Check endpoint
app.get('/health', (req, res) => {
  const isDbConnected = mongoose.connection.readyState === 1;
  const uptime = process.uptime();
  const memoryUsage = process.memoryUsage();

  res.status(isDbConnected ? 200 : 503).json({
    status: isDbConnected ? 'healthy' : 'degraded',
    database: isDbConnected ? 'connected' : 'disconnected',
    uptime: Math.floor(uptime),
    memory: {
      rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) // MB
    },
    timestamp: new Date().toISOString()
  });
});

// API Routes with rate limiting
app.use('/api', apiLimiter, routes);

// ✅ FIX 4: Correct 404 error code
app.use((req, res) => {
  res.status(404).json({
    success: false,
    code: 'NOT_FOUND', // ✅ Fixed: was 'VALIDATION_ERROR'
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Centralized error handler (must be last middleware)
app.use(errorHandler);

// Graceful shutdown handler
process.on('SIGTERM', () => {
  logger.info('[App] SIGTERM received, shutting down gracefully...');
  mongoose.connection.close(false, () => {
    logger.info('[App] MongoDB connection closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('[App] SIGINT received, shutting down gracefully...');
  mongoose.connection.close(false, () => {
    logger.info('[App] MongoDB connection closed');
    process.exit(0);
  });
});

module.exports = app;
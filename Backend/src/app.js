const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');

const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const { FRONTEND_URL, NODE_ENV, TRUST_PROXY_HOPS } = require('./config/env');
const { apiLimiter } = require('./middleware/rateLimit');
const ApiError = require('./utils/apiError');

const app = express();

// Trust only the explicitly configured number of reverse-proxy hops.
app.set('trust proxy', TRUST_PROXY_HOPS);

// Security Headers
app.use(helmet());

app.use((req, res, next) => {
  const origin = req.get('Origin');
  const localDevOrigin = NODE_ENV !== 'production' && origin && /^http:\/\/localhost:\d+$/.test(origin);
  if (origin && origin !== FRONTEND_URL && !localDevOrigin) {
    return next(ApiError.forbidden('Request origin is not allowed.'));
  }
  next();
});

// CORS configuration supporting credentials
app.use(
  cors({
    origin: (origin, callback) => {
      // Requests without Origin are server-to-server; browser requests must match the configured app origin.
      if (!origin || origin === FRONTEND_URL || (NODE_ENV !== 'production' && /^http:\/\/localhost:\d+$/.test(origin))) {
        return callback(null, true);
      }
      callback(null, false);
    },
    credentials: true
  })
);

// Body parsers & Cookie parser
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: true, limit: '32kb', parameterLimit: 100 }));
app.use(cookieParser());

// Health Check endpoint per Section 6
app.get('/health', (req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({ ok: ready });
});

// API Routes
app.use('/api', apiLimiter, routes);

// 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    code: 'VALIDATION_ERROR',
    message: 'Route not found'
  });
});

// Centralized error handler
app.use(errorHandler);

module.exports = app;

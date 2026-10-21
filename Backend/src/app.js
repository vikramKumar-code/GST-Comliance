const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const { FRONTEND_URL } = require('./config/env');

const app = express();

// Trust proxy for rate limiting behind reverse proxies / test headers
app.set('trust proxy', 1);

// Security Headers
app.use(helmet());

// CORS configuration supporting credentials
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like curl, test scripts) or matching FRONTEND_URL / localhost
      if (!origin || origin === FRONTEND_URL || origin.startsWith('http://localhost:')) {
        return callback(null, true);
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true
  })
);

// Body parsers & Cookie parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Health Check endpoint per Section 6
app.get('/health', (req, res) => {
  res.status(200).json({ ok: true });
});

// API Routes
app.use('/api', routes);

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

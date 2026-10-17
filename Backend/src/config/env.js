require('dotenv').config();

const config = {
  PORT: parseInt(process.env.PORT, 10) || 4000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/gstapp',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
  USE_MOCK: process.env.USE_MOCK !== 'false', // Default to true per specs
  FINAGG_BASE_URL: process.env.FINAGG_BASE_URL || '',
  FINAGG_API_KEY: process.env.FINAGG_API_KEY || '',
  DATA_ENCRYPTION_KEY: process.env.DATA_ENCRYPTION_KEY || '',
  JWT_SECRET: process.env.JWT_SECRET || 'dev_secret_jwt_key_do_not_use_in_prod',
  SESSION_HOURS: parseInt(process.env.SESSION_HOURS, 10) || 6,
  isProduction: process.env.NODE_ENV === 'production'
};

module.exports = config;

const mongoose = require('mongoose');
const { MONGO_URI } = require('./env');
const logger = require('../utils/logger');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(MONGO_URI);
    logger.info(`MongoDB connected: ${conn.connection.host}`);

    // Ensure models are registered and partialFilterExpression indexes synced
    try {
      const Workspace = require('../models/Workspace');
      const User = require('../models/User');
      await Promise.all([
        Workspace.syncIndexes().catch(() => {}),
        User.syncIndexes().catch(() => {})
      ]);
    } catch {
      // Non-fatal index sync
    }

    return conn;
  } catch (error) {
    logger.error('MongoDB connection failed', { name: error.name, code: error.code });
    throw error;
  }
};

module.exports = connectDB;

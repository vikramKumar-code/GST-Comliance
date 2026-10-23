const mongoose = require('mongoose');
const app = require('./src/app');
const connectDB = require('./src/config/mongo');
const { PORT, TRUST_PROXY_HOPS } = require('./src/config/env');
const logger = require('./src/utils/logger');

let server;

async function startServer() {
  await connectDB();
  server = app.listen(PORT, () => {
    logger.info('Application listening', { port: PORT, trustedProxyHops: TRUST_PROXY_HOPS });
  });
  return server;
}

async function stopServer(signal) {
  logger.info('Shutting down application', { signal });
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await mongoose.disconnect();
}

if (require.main === module) {
  startServer().catch((error) => {
    logger.error('Application startup failed', { name: error.name, code: error.code });
    process.exitCode = 1;
  });

  process.once('SIGTERM', () => stopServer('SIGTERM').finally(() => process.exit(0)));
  process.once('SIGINT', () => stopServer('SIGINT').finally(() => process.exit(0)));
}

module.exports = { startServer, stopServer };

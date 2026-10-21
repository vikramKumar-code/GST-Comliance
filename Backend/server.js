const app = require('./src/app');
const connectDB = require('./src/config/mongo');
const { PORT } = require('./src/config/env');

const server = app.listen(PORT, async () => {
  await connectDB();
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});

module.exports = server;

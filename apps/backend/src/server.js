const { loadConfig } = require('./config/env');
const { createLogger } = require('./config/logger');
const { connectDatabase, disconnectDatabase } = require('./db/connection');
const { createApp } = require('./app');

async function startServer() {
  const config = loadConfig();
  const logger = createLogger(config);

  await connectDatabase(config.mongoUri);
  const app = createApp({ config, logger });
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'Backend server listening');
  });

  const shutdown = (signal) => {
    logger.info({ signal }, 'Shutting down backend server');
    server.close(async (error) => {
      if (error) {
        logger.error({ err: error }, 'HTTP server shutdown failed');
        process.exitCode = 1;
      }
      await disconnectDatabase();
    });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  return server;
}

if (require.main === module) {
  startServer().catch((error) => {
    process.stderr.write(`Backend startup failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { startServer };

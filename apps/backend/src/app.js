const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const { createHealthService } = require('./services/health.service');
const { errorHandler } = require('./middleware/errorHandler');
const { notFound } = require('./middleware/notFound');
const { createRequestLogger } = require('./middleware/requestLogger');
const { requestId } = require('./middleware/requestId');
const { createHealthRouter } = require('./routes/health.routes');
const { AppError } = require('./utils/AppError');

function createApp({ config, logger, healthService = createHealthService() }) {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
        return callback(new AppError(403, 'cors_origin_denied', 'Origin is not allowed'));
      },
    }),
  );
  app.use(createRequestLogger(logger));
  app.use(requestId);
  app.use(express.json({ limit: config.requestBodyLimit }));
  app.use(express.urlencoded({ extended: false, limit: config.requestBodyLimit }));
  app.use('/api/v1', createHealthRouter(healthService));
  app.use(notFound);
  app.use(errorHandler(logger));

  return app;
}

module.exports = { createApp };

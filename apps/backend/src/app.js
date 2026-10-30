const cors = require('cors');
const cookieParser = require('cookie-parser');
const express = require('express');
const helmet = require('helmet');
const modelsDefault = require('./models');
const { createAuditService } = require('./services/audit.service');
const { createAuthService } = require('./services/auth.service');
const { createEmailService } = require('./services/email.service');
const { createHealthService } = require('./services/health.service');
const { createMembershipService } = require('./services/membership.service');
const { createPlatformService } = require('./services/platform.service');
const { createPropertyService } = require('./services/property.service');
const { createSettingsService } = require('./services/settings.service');
const { createAuthRouter } = require('./routes/auth.routes');
const { errorHandler } = require('./middleware/errorHandler');
const { notFound } = require('./middleware/notFound');
const { createRequestLogger } = require('./middleware/requestLogger');
const { requestId } = require('./middleware/requestId');
const { createHealthRouter } = require('./routes/health.routes');
const { createMembershipRouter } = require('./routes/membership.routes');
const { createPlatformRouter } = require('./routes/platform.routes');
const { createPropertyRouter } = require('./routes/property.routes');
const { createSettingsRouter } = require('./routes/settings.routes');
const { AppError } = require('./utils/AppError');

function createApp({
  config,
  logger,
  models = modelsDefault,
  audit: suppliedAudit,
  mailer: suppliedMailer,
  authService: suppliedAuthService,
  membershipService: suppliedMembershipService,
  healthService = createHealthService(),
}) {
  const app = express();
  const audit = suppliedAudit ?? createAuditService({ AuditLog: models.AuditLog });
  const mailer = suppliedMailer ?? createEmailService({ config, logger });
  const authService =
    suppliedAuthService ?? createAuthService({ models, audit, mailer, config, logger });
  const membershipService =
    suppliedMembershipService ?? createMembershipService({ models, audit, mailer, config });
  const platformService = createPlatformService({
    models,
    audit,
    membershipService,
    mailer,
    healthService,
  });
  const settingsService = createSettingsService({ models, audit });
  const propertyService = createPropertyService({ models, audit, membershipService });
  app.locals.emailVerificationRequired = config.emailVerificationRequired;

  app.disable('x-powered-by');
  app.use(helmet({ referrerPolicy: { policy: 'no-referrer' } }));
  app.use(createRequestLogger(logger));
  app.use(requestId);
  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
        return callback(new AppError(403, 'cors_origin_denied', 'Origin is not allowed'));
      },
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: config.requestBodyLimit }));
  app.use(express.urlencoded({ extended: false, limit: config.requestBodyLimit }));
  app.use('/api/v1', createHealthRouter(healthService));
  app.use('/api/v1/auth', createAuthRouter({ config, models, audit, authService }));
  app.use('/api/v1', createPlatformRouter({ config, models, audit, platformService }));
  app.use('/api/v1', createMembershipRouter({ config, models, audit, membershipService }));
  app.use('/api/v1', createSettingsRouter({ models, audit, settingsService }));
  app.use('/api/v1', createPropertyRouter({ models, audit, propertyService }));
  app.use(notFound);
  app.use(errorHandler(logger));

  return app;
}

module.exports = { createApp };

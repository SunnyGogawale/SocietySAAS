const express = require('express');
const { createSettingsController } = require('../controllers/settings.controller');
const { createAuthenticate } = require('../middleware/authenticate');
const { csrfProtection } = require('../middleware/csrfProtection');
const { requirePermissions } = require('../middleware/authorize');
const { requireSocietyContext } = require('../middleware/requireSocietyContext');
const { validateRequest } = require('../middleware/validateRequest');
const { societyIdParamsSchema } = require('../validators/auth.validators');
const { updateSettingsSchema } = require('../validators/settings.validators');

function createSettingsRouter({ models, audit, settingsService }) {
  const router = express.Router();
  const controller = createSettingsController({ settingsService });
  const authenticate = createAuthenticate({ models, audit });
  const societyContext = requireSocietyContext({ models, audit });

  router.get(
    '/societies/:societyId/settings',
    authenticate,
    validateRequest({ params: societyIdParamsSchema }),
    societyContext,
    requirePermissions(audit, 'settings:read'),
    controller.getSettings,
  );
  router.patch(
    '/societies/:societyId/settings',
    authenticate,
    csrfProtection,
    validateRequest({ params: societyIdParamsSchema, body: updateSettingsSchema }),
    societyContext,
    requirePermissions(audit, 'settings:manage'),
    controller.updateSettings,
  );
  return router;
}

module.exports = { createSettingsRouter };

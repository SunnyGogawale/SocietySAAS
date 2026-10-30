const express = require('express');
const { createHealthController } = require('../controllers/health.controller');
const { validateRequest } = require('../middleware/validateRequest');
const { healthQuerySchema } = require('../validators/health.validators');

function createHealthRouter(healthService) {
  const router = express.Router();
  const controller = createHealthController(healthService);
  const validateHealthQuery = validateRequest({ query: healthQuerySchema });

  router.get('/health', validateHealthQuery, controller.getHealth);
  router.get('/ready', validateHealthQuery, controller.getReadiness);

  return router;
}

module.exports = { createHealthRouter };

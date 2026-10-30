const { sendSuccess } = require('../utils/apiResponse');

function createHealthController(healthService) {
  return {
    getHealth(request, response) {
      return sendSuccess(request, response, healthService.getHealth());
    },

    getReadiness(request, response) {
      const readiness = healthService.getReadiness();
      return sendSuccess(request, response, readiness, readiness.ready ? 200 : 503);
    },
  };
}

module.exports = { createHealthController };

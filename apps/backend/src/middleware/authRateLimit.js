const { rateLimit } = require('express-rate-limit');
const { sendError } = require('../utils/apiResponse');

function createAuthRateLimit(config, audit) {
  return rateLimit({
    windowMs: config.authRateLimitWindowMs,
    limit: config.authRateLimitMax,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    async handler(request, response) {
      await audit?.record({
        actorId: request.auth?.user?._id ?? null,
        societyId: request.society?._id ?? null,
        action: 'auth.rate_limit',
        outcome: 'failure',
        requestId: request.id,
        metadata: { method: request.method },
      });
      return sendError(request, response, {
        statusCode: 429,
        code: 'rate_limit_exceeded',
        message: 'Too many authentication attempts. Try again later.',
      });
    },
  });
}

module.exports = { createAuthRateLimit };

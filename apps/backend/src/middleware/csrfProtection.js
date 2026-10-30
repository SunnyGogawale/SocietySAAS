const { CSRF_COOKIE } = require('./authenticate');
const { hashToken, safeEqual } = require('../utils/securityToken');
const { sendError } = require('../utils/apiResponse');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrfProtection(request, response, next) {
  if (!request.auth || request.auth.transport === 'bearer' || SAFE_METHODS.has(request.method)) {
    return next();
  }

  const cookieToken = request.cookies?.[CSRF_COOKIE];
  const headerToken = request.get('x-csrf-token');
  const expectedHash = request.auth.session.csrfTokenHash;
  if (
    typeof cookieToken === 'string' &&
    typeof headerToken === 'string' &&
    safeEqual(cookieToken, headerToken) &&
    safeEqual(hashToken(headerToken), expectedHash)
  ) {
    return next();
  }

  return sendError(request, response, {
    statusCode: 403,
    code: 'csrf_invalid',
    message: 'A valid CSRF token is required',
  });
}

module.exports = { csrfProtection };

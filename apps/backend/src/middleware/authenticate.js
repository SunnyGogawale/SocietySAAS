const { hashToken } = require('../utils/securityToken');
const { sendError } = require('../utils/apiResponse');

const SESSION_COOKIE = 'societysaas_session';
const CSRF_COOKIE = 'societysaas_csrf';

function getSessionCredential(request) {
  const authorization = request.get('authorization');
  if (authorization) {
    const match = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(authorization);
    return match ? { token: match[1], transport: 'bearer' } : null;
  }

  const token = request.cookies?.[SESSION_COOKIE];
  return typeof token === 'string' ? { token, transport: 'cookie' } : null;
}

function createAuthenticate({ models, audit, clock = () => new Date() }) {
  return async function authenticate(request, response, next) {
    const credential = getSessionCredential(request);
    if (!credential) {
      await audit.record({
        action: 'auth.access.denied',
        outcome: 'failure',
        requestId: request.id,
        metadata: { reason: 'credentials_missing', method: request.method },
      });
      return sendError(request, response, {
        statusCode: 401,
        code: 'authentication_required',
        message: 'Authentication is required',
      });
    }

    const session = await models.Session.findOne({
      tokenHash: hashToken(credential.token),
      transport: credential.transport,
      revokedAt: null,
      expiresAt: { $gt: clock() },
    }).select('+tokenHash +csrfTokenHash');

    if (!session) {
      await audit.record({
        action: 'auth.access.denied',
        outcome: 'failure',
        requestId: request.id,
        metadata: { reason: 'session_invalid', method: request.method },
      });
      return sendError(request, response, {
        statusCode: 401,
        code: 'session_invalid',
        message: 'The session is invalid or has expired',
      });
    }

    const user = await models.User.findOne({ _id: session.userId, accountStatus: 'active' });
    if (!user || (request.app.locals.emailVerificationRequired && !user.emailVerifiedAt)) {
      await audit.record({
        actorId: user?._id ?? null,
        action: 'auth.access.denied',
        outcome: 'failure',
        requestId: request.id,
        metadata: { reason: 'account_unavailable', method: request.method },
      });
      return sendError(request, response, {
        statusCode: 401,
        code: 'session_invalid',
        message: 'The session is invalid or has expired',
      });
    }

    request.auth = { session, user, transport: credential.transport };
    session.lastUsedAt = clock();
    await session.save();
    return next();
  };
}

module.exports = { CSRF_COOKIE, SESSION_COOKIE, createAuthenticate };

const { hashToken } = require('../utils/securityToken');
const { SESSION_COOKIE } = require('./authenticate');

function createOptionalAuthenticate({
  models,
  emailVerificationRequired,
  clock = () => new Date(),
}) {
  return async function optionalAuthenticate(request, response, next) {
    const authorization = request.get('authorization');
    let token;
    let transport;
    if (authorization) {
      const match = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(authorization);
      if (match) {
        token = match[1];
        transport = 'bearer';
      }
    } else if (typeof request.cookies?.[SESSION_COOKIE] === 'string') {
      token = request.cookies[SESSION_COOKIE];
      transport = 'cookie';
    }

    if (!token) return next();

    const session = await models.Session.findOne({
      tokenHash: hashToken(token),
      transport,
      revokedAt: null,
      expiresAt: { $gt: clock() },
    }).select('+tokenHash +csrfTokenHash');
    if (!session) return next();

    const user = await models.User.findOne({ _id: session.userId, accountStatus: 'active' });
    if (!user || (emailVerificationRequired && !user.emailVerifiedAt)) return next();

    request.auth = { session, user, transport };
    return next();
  };
}

module.exports = { createOptionalAuthenticate };

const { CSRF_COOKIE, SESSION_COOKIE } = require('../middleware/authenticate');
const { sendSuccess } = require('../utils/apiResponse');
const { toPublicUser } = require('../services/auth.service');

function cookieOptions(config, httpOnly) {
  return {
    httpOnly,
    secure: config.nodeEnv === 'production',
    sameSite: 'strict',
    path: '/api/v1',
  };
}

function createAuthController({ authService, config }) {
  function setSessionCookies(response, result) {
    const maxAge = config.sessionTtlDays * 86400000;
    response.cookie(SESSION_COOKIE, result.sessionToken, {
      ...cookieOptions(config, true),
      maxAge,
    });
    response.cookie(CSRF_COOKIE, result.csrfToken, {
      ...cookieOptions(config, false),
      maxAge,
    });
  }

  function clearSessionCookies(response) {
    response.clearCookie(SESSION_COOKIE, cookieOptions(config, true));
    response.clearCookie(CSRF_COOKIE, cookieOptions(config, false));
  }

  return {
    async login(request, response) {
      const transport = request.get('x-session-transport') === 'bearer' ? 'bearer' : 'cookie';
      const result = await authService.login({
        ...request.validated.body,
        request,
        transport,
      });
      if (transport === 'cookie') setSessionCookies(response, result);
      const { sessionToken, ...publicResult } = result;
      return sendSuccess(
        request,
        response,
        transport === 'bearer' ? { ...publicResult, sessionToken } : publicResult,
      );
    },

    async logout(request, response) {
      await authService.logout({ session: request.auth.session, request });
      clearSessionCookies(response);
      return sendSuccess(request, response, { loggedOut: true });
    },

    async me(request, response) {
      const societies = await authService.listSocieties(request.auth.user._id);
      const activeSocietyId = request.auth.session.activeSocietyId
        ? String(request.auth.session.activeSocietyId)
        : null;
      const data = {
        user: toPublicUser(request.auth.user),
        societies,
        activeSociety: societies.find((society) => society.id === activeSocietyId) ?? null,
      };
      if (request.auth.transport === 'cookie') {
        data.csrfToken = request.cookies?.[CSRF_COOKIE] ?? null;
      }
      response.setHeader('x-csrf-token', request.cookies?.[CSRF_COOKIE] ?? '');
      return sendSuccess(request, response, data);
    },

    async listSocieties(request, response) {
      const societies = await authService.listSocieties(request.auth.user._id);
      return sendSuccess(request, response, { societies });
    },

    async selectSociety(request, response) {
      const society = await authService.selectSociety({
        user: request.auth.user,
        session: request.auth.session,
        societyId: request.params.societyId,
        request,
      });
      return sendSuccess(request, response, { activeSociety: society });
    },

    async updateProfile(request, response) {
      const user = await authService.updateProfile({
        user: request.auth.user,
        request,
        ...request.validated.body,
      });
      return sendSuccess(request, response, { user });
    },

    async requestPasswordReset(request, response) {
      await authService.requestPasswordReset({
        email: request.validated.body.email,
        request,
      });
      return sendSuccess(
        request,
        response,
        {
          message: 'If an account matches that email, password reset instructions will be sent.',
        },
        202,
      );
    },

    async resetPassword(request, response) {
      await authService.resetPassword({ ...request.validated.body, request });
      return sendSuccess(request, response, { passwordReset: true });
    },

    async verifyEmail(request, response) {
      await authService.verifyEmail({ ...request.validated.body, request });
      return sendSuccess(request, response, { emailVerified: true });
    },

    async acceptInvitation(request, response) {
      const result = await authService.acceptInvitation({
        ...request.validated.body,
        authenticatedUser: request.auth?.user,
        request,
      });
      return sendSuccess(request, response, result);
    },
  };
}

module.exports = { createAuthController };

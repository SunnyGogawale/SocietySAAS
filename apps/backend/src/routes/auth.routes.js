const express = require('express');
const { createAuthController } = require('../controllers/auth.controller');
const { createAuthenticate } = require('../middleware/authenticate');
const { createAuthRateLimit } = require('../middleware/authRateLimit');
const { csrfProtection } = require('../middleware/csrfProtection');
const { createOptionalAuthenticate } = require('../middleware/optionalAuthenticate');
const { validateRequest } = require('../middleware/validateRequest');
const {
  acceptInvitationSchema,
  emptyObject,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  societyIdParamsSchema,
  updateProfileSchema,
  verifyEmailSchema,
} = require('../validators/auth.validators');

function createAuthRouter({ config, models, audit, authService }) {
  const router = express.Router();
  router.use((request, response, next) => {
    response.setHeader('cache-control', 'no-store');
    next();
  });
  const controller = createAuthController({ authService, config });
  const authenticate = createAuthenticate({ models, audit });
  const optionalAuthenticate = createOptionalAuthenticate({
    models,
    emailVerificationRequired: config.emailVerificationRequired,
  });
  const authRateLimit = createAuthRateLimit(config, audit);
  const validateBody = (schema) => validateRequest({ body: schema });

  router.post('/login', authRateLimit, validateBody(loginSchema), controller.login);
  router.post(
    '/logout',
    authenticate,
    csrfProtection,
    validateBody(emptyObject),
    controller.logout,
  );
  router.get('/me', authenticate, controller.me);
  router.get('/societies', authenticate, controller.listSocieties);
  router.post(
    '/societies/:societyId/select',
    authenticate,
    csrfProtection,
    validateRequest({
      params: societyIdParamsSchema,
      body: emptyObject,
    }),
    controller.selectSociety,
  );
  router.patch(
    '/profile',
    authenticate,
    csrfProtection,
    validateBody(updateProfileSchema),
    controller.updateProfile,
  );
  router.post(
    '/password/forgot',
    authRateLimit,
    validateBody(forgotPasswordSchema),
    controller.requestPasswordReset,
  );
  router.post(
    '/password/reset',
    authRateLimit,
    validateBody(resetPasswordSchema),
    controller.resetPassword,
  );
  router.post(
    '/email/verify',
    authRateLimit,
    validateBody(verifyEmailSchema),
    controller.verifyEmail,
  );
  router.post(
    '/invitations/accept',
    authRateLimit,
    optionalAuthenticate,
    csrfProtection,
    validateBody(acceptInvitationSchema),
    controller.acceptInvitation,
  );

  return router;
}

module.exports = { createAuthRouter };

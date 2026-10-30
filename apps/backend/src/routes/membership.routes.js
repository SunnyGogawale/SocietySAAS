const express = require('express');
const { createMembershipController } = require('../controllers/membership.controller');
const { createAuthenticate } = require('../middleware/authenticate');
const { createAuthRateLimit } = require('../middleware/authRateLimit');
const { csrfProtection } = require('../middleware/csrfProtection');
const { requirePermissions } = require('../middleware/authorize');
const { requireSocietyContext } = require('../middleware/requireSocietyContext');
const { validateRequest } = require('../middleware/validateRequest');
const {
  createSocietySchema,
  inviteAdminSchema,
  inviteOwnerSchema,
  memberListQuerySchema,
  updateMembershipRoleSchema,
  updateMembershipSchema,
} = require('../validators/membership.validators');
const { idParamsSchema, societyIdParamsSchema } = require('../validators/auth.validators');

function createMembershipRouter({ config, models, audit, membershipService }) {
  const router = express.Router();
  const controller = createMembershipController({ membershipService });
  const authenticate = createAuthenticate({ models, audit });
  const authRateLimit = createAuthRateLimit(config, audit);
  const societyContext = requireSocietyContext({ models, audit });

  router.post(
    '/platform/societies',
    authenticate,
    csrfProtection,
    requirePermissions(audit, 'platform:societies:create'),
    validateRequest({ body: createSocietySchema }),
    controller.createSociety,
  );
  router.post(
    '/platform/societies/:societyId/invitations',
    authenticate,
    csrfProtection,
    requirePermissions(audit, 'platform:societies:create'),
    authRateLimit,
    validateRequest({ params: societyIdParamsSchema, body: inviteAdminSchema }),
    controller.invitePlatformAdmin,
  );
  router.patch(
    '/platform/societies/:societyId/memberships/:membershipId/role',
    authenticate,
    csrfProtection,
    requirePermissions(audit, 'platform:societies:create'),
    validateRequest({ params: idParamsSchema, body: updateMembershipRoleSchema }),
    controller.updateMembershipRole,
  );

  router.get(
    '/societies/:societyId/memberships',
    authenticate,
    validateRequest({ params: societyIdParamsSchema, query: memberListQuerySchema }),
    societyContext,
    requirePermissions(audit, 'members:read'),
    controller.listMemberships,
  );
  router.post(
    '/societies/:societyId/invitations',
    authenticate,
    csrfProtection,
    validateRequest({ params: societyIdParamsSchema, body: inviteOwnerSchema }),
    societyContext,
    requirePermissions(audit, 'members:invite'),
    authRateLimit,
    controller.inviteOwner,
  );
  router.patch(
    '/societies/:societyId/memberships/:membershipId/status',
    authenticate,
    csrfProtection,
    validateRequest({ params: idParamsSchema, body: updateMembershipSchema }),
    societyContext,
    requirePermissions(audit, 'members:manage'),
    controller.updateMembershipStatus,
  );

  return router;
}

module.exports = { createMembershipRouter };

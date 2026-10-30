const express = require('express');
const { createPlatformController } = require('../controllers/platform.controller');
const { createAuthenticate } = require('../middleware/authenticate');
const { createAuthRateLimit } = require('../middleware/authRateLimit');
const { csrfProtection } = require('../middleware/csrfProtection');
const { requirePlatformAdmin, requirePermissions } = require('../middleware/authorize');
const { requireSocietyContext } = require('../middleware/requireSocietyContext');
const { validateRequest } = require('../middleware/validateRequest');
const { societyIdParamsSchema } = require('../validators/auth.validators');
const { inviteAdminSchema } = require('../validators/membership.validators');
const schemas = require('../validators/platform.validators');

function createPlatformRouter({ config, models, audit, platformService }) {
  const router = express.Router();
  const controller = createPlatformController({ platformService });
  const authenticate = createAuthenticate({ models, audit });
  const platformAdmin = requirePlatformAdmin(audit);
  const societyContext = requireSocietyContext({ models, audit });
  const rateLimit = createAuthRateLimit(config, audit);

  router.post(
    '/platform/registrations',
    rateLimit,
    validateRequest({ body: schemas.registrationSchema }),
    controller.submitRegistration,
  );
  router.get('/platform/dashboard', authenticate, platformAdmin, controller.dashboard);
  router.get(
    '/platform/societies/export',
    authenticate,
    platformAdmin,
    validateRequest({ query: schemas.societyListQuerySchema }),
    controller.exportSocieties,
  );
  router.get(
    '/platform/societies',
    authenticate,
    platformAdmin,
    validateRequest({ query: schemas.societyListQuerySchema }),
    controller.listSocieties,
  );
  router.get(
    '/platform/societies/:societyId',
    authenticate,
    platformAdmin,
    validateRequest({ params: societyIdParamsSchema }),
    controller.getSociety,
  );
  router.post(
    '/platform/societies/:societyId/approve',
    authenticate,
    csrfProtection,
    platformAdmin,
    validateRequest({ params: societyIdParamsSchema, body: schemas.approveSchema }),
    controller.approveRegistration,
  );
  router.post(
    '/platform/societies/:societyId/reject',
    authenticate,
    csrfProtection,
    platformAdmin,
    validateRequest({ params: societyIdParamsSchema, body: schemas.rejectSchema }),
    controller.rejectRegistration,
  );
  router.patch(
    '/platform/societies/:societyId/profile',
    authenticate,
    csrfProtection,
    platformAdmin,
    validateRequest({ params: societyIdParamsSchema, body: schemas.societyProfileSchema }),
    controller.updateSocietyProfile,
  );
  router.patch(
    '/platform/societies/:societyId/status',
    authenticate,
    csrfProtection,
    platformAdmin,
    validateRequest({ params: societyIdParamsSchema, body: schemas.societyStatusSchema }),
    controller.changeSocietyStatus,
  );
  router.put(
    '/platform/societies/:societyId/primary-admin',
    authenticate,
    csrfProtection,
    platformAdmin,
    validateRequest({ params: societyIdParamsSchema, body: schemas.primaryAdminSchema }),
    controller.setPrimaryAdmin,
  );
  router.patch(
    '/platform/societies/:societyId/subscription',
    authenticate,
    csrfProtection,
    platformAdmin,
    validateRequest({ params: societyIdParamsSchema, body: schemas.subscriptionSchema }),
    controller.updateSubscription,
  );
  router.post(
    '/platform/societies/:societyId/invitations',
    authenticate,
    csrfProtection,
    platformAdmin,
    rateLimit,
    validateRequest({ params: societyIdParamsSchema, body: inviteAdminSchema }),
    controller.inviteSocietyAdmin,
  );

  router.get('/platform/plans', authenticate, platformAdmin, controller.listPlans);
  router.post(
    '/platform/plans',
    authenticate,
    csrfProtection,
    platformAdmin,
    validateRequest({ body: schemas.planSchema }),
    controller.createPlan,
  );
  router.patch(
    '/platform/plans/:planId',
    authenticate,
    csrfProtection,
    platformAdmin,
    validateRequest({ params: schemas.planParamsSchema, body: schemas.updatePlanSchema }),
    controller.updatePlan,
  );
  router.get(
    '/platform/audit-logs/export',
    authenticate,
    platformAdmin,
    validateRequest({ query: schemas.auditQuerySchema }),
    controller.exportAuditLogs,
  );
  router.get(
    '/platform/audit-logs',
    authenticate,
    platformAdmin,
    validateRequest({ query: schemas.auditQuerySchema }),
    controller.listAuditLogs,
  );
  router.get(
    '/platform/support-tickets/export',
    authenticate,
    platformAdmin,
    validateRequest({ query: schemas.ticketQuerySchema }),
    controller.exportSupportTickets,
  );
  router.get(
    '/platform/support-tickets',
    authenticate,
    platformAdmin,
    validateRequest({ query: schemas.ticketQuerySchema }),
    controller.listSupportTickets,
  );
  router.patch(
    '/platform/support-tickets/:ticketId',
    authenticate,
    csrfProtection,
    platformAdmin,
    validateRequest({ params: schemas.ticketParamsSchema, body: schemas.updateTicketSchema }),
    controller.updateSupportTicket,
  );

  router.post(
    '/societies/:societyId/support-tickets',
    authenticate,
    csrfProtection,
    validateRequest({ params: societyIdParamsSchema, body: schemas.createTicketSchema }),
    societyContext,
    requirePermissions(audit, 'support:tickets:create'),
    controller.createSupportTicket,
  );
  router.get(
    '/societies/:societyId/support-tickets',
    authenticate,
    validateRequest({ params: societyIdParamsSchema, query: schemas.ticketQuerySchema }),
    societyContext,
    requirePermissions(audit, 'members:read'),
    controller.listSocietyTickets,
  );

  return router;
}

module.exports = { createPlatformRouter };

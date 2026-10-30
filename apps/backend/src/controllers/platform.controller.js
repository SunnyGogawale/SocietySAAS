const { sendSuccess } = require('../utils/apiResponse');

function csvResponse(request, response, result, filename) {
  response.setHeader('content-type', 'text/csv; charset=utf-8');
  response.setHeader('content-disposition', `attachment; filename="${filename}"`);
  response.setHeader('x-export-truncated', String(result.truncated));
  response.status(200).send(result.csv);
}

function createPlatformController({ platformService }) {
  return {
    async dashboard(request, response) {
      return sendSuccess(request, response, await platformService.getDashboard());
    },
    async submitRegistration(request, response) {
      const registration = await platformService.submitRegistration(
        request.validated.body,
        request,
      );
      return sendSuccess(request, response, { registration }, 201);
    },
    async listSocieties(request, response) {
      return sendSuccess(
        request,
        response,
        await platformService.listSocieties(request.validated.query),
      );
    },
    async exportSocieties(request, response) {
      const result = await platformService.exportSocieties({
        ...request.validated.query,
        actor: request.auth.user,
        request,
      });
      return csvResponse(request, response, result, 'societies.csv');
    },
    async getSociety(request, response) {
      return sendSuccess(
        request,
        response,
        await platformService.getSociety(request.params.societyId),
      );
    },
    async approveRegistration(request, response) {
      const result = await platformService.approveRegistration({
        ...request.validated.body,
        societyId: request.params.societyId,
        actor: request.auth.user,
        request,
      });
      return sendSuccess(request, response, result);
    },
    async rejectRegistration(request, response) {
      const result = await platformService.rejectRegistration({
        ...request.validated.body,
        societyId: request.params.societyId,
        actor: request.auth.user,
        request,
      });
      return sendSuccess(request, response, { society: result });
    },
    async updateSocietyProfile(request, response) {
      return sendSuccess(
        request,
        response,
        await platformService.updateSocietyProfile({
          societyId: request.params.societyId,
          changes: request.validated.body,
          actor: request.auth.user,
          request,
        }),
      );
    },
    async changeSocietyStatus(request, response) {
      const society = await platformService.changeSocietyStatus({
        societyId: request.params.societyId,
        status: request.validated.body.status,
        actor: request.auth.user,
        request,
      });
      return sendSuccess(request, response, { society });
    },
    async setPrimaryAdmin(request, response) {
      return sendSuccess(
        request,
        response,
        await platformService.setPrimaryAdmin({
          societyId: request.params.societyId,
          membershipId: request.validated.body.membershipId,
          actor: request.auth.user,
          request,
        }),
      );
    },
    async listPlans(request, response) {
      return sendSuccess(
        request,
        response,
        await platformService.listPlans({
          includeArchived: request.query.includeArchived === 'true',
        }),
      );
    },
    async createPlan(request, response) {
      return sendSuccess(
        request,
        response,
        await platformService.createPlan(request.validated.body, request.auth.user, request),
        201,
      );
    },
    async updatePlan(request, response) {
      return sendSuccess(
        request,
        response,
        await platformService.updatePlan({
          planId: request.params.planId,
          changes: request.validated.body,
          actor: request.auth.user,
          request,
        }),
      );
    },
    async updateSubscription(request, response) {
      return sendSuccess(
        request,
        response,
        await platformService.updateSubscription({
          societyId: request.params.societyId,
          changes: request.validated.body,
          actor: request.auth.user,
          request,
        }),
      );
    },
    async inviteSocietyAdmin(request, response) {
      const membership = await platformService.inviteSocietyAdmin({
        societyId: request.params.societyId,
        email: request.validated.body.email,
        actor: request.auth.user,
        request,
      });
      return sendSuccess(request, response, { membership }, 201);
    },
    async listAuditLogs(request, response) {
      return sendSuccess(
        request,
        response,
        await platformService.listAuditLogs(request.validated.query),
      );
    },
    async exportAuditLogs(request, response) {
      const result = await platformService.exportAuditLogs({
        ...request.validated.query,
        actor: request.auth.user,
        request,
      });
      return csvResponse(request, response, result, 'platform-audit.csv');
    },
    async listSupportTickets(request, response) {
      return sendSuccess(
        request,
        response,
        await platformService.listSupportTickets(request.validated.query),
      );
    },
    async exportSupportTickets(request, response) {
      const result = await platformService.exportSupportTickets({
        ...request.validated.query,
        actor: request.auth.user,
        request,
      });
      return csvResponse(request, response, result, 'support-tickets.csv');
    },
    async updateSupportTicket(request, response) {
      const result = await platformService.updateSupportTicket({
        ticketId: request.params.ticketId,
        changes: request.validated.body,
        actor: request.auth.user,
        request,
      });
      return sendSuccess(request, response, result);
    },
    async createSupportTicket(request, response) {
      const result = await platformService.createSupportTicket({
        society: request.society,
        actor: request.auth.user,
        input: request.validated.body,
        request,
      });
      return sendSuccess(request, response, result, 201);
    },
    async listSocietyTickets(request, response) {
      const result = await platformService.listSocietyTickets({
        society: request.society,
        ...request.validated.query,
      });
      return sendSuccess(request, response, result);
    },
  };
}

module.exports = { createPlatformController };

const { sendSuccess } = require('../utils/apiResponse');

function createMembershipController({ membershipService }) {
  return {
    async createSociety(request, response) {
      const society = await membershipService.createSociety({
        ...request.validated.body,
        actor: request.auth.user,
        request,
      });
      return sendSuccess(request, response, { society }, 201);
    },

    async invitePlatformAdmin(request, response) {
      const membership = await membershipService.inviteMember({
        societyId: request.params.societyId,
        role: 'society_admin',
        email: request.validated.body.email,
        actor: request.auth.user,
        request,
      });
      return sendSuccess(request, response, { membership }, 201);
    },

    async inviteOwner(request, response) {
      const membership = await membershipService.inviteMember({
        society: request.society,
        role: 'house_owner',
        email: request.validated.body.email,
        actor: request.auth.user,
        request,
      });
      return sendSuccess(request, response, { membership }, 201);
    },

    async listMemberships(request, response) {
      const result = await membershipService.listMemberships({
        society: request.society,
        status: request.validated.query.status,
        page: request.validated.query.page,
        limit: request.validated.query.limit,
      });
      return sendSuccess(request, response, result);
    },

    async updateMembershipStatus(request, response) {
      const membership = await membershipService.updateMembershipStatus({
        society: request.society,
        actor: request.auth.user,
        membershipId: request.params.membershipId,
        status: request.validated.body.status,
        request,
      });
      return sendSuccess(request, response, { membership });
    },

    async updateMembershipRole(request, response) {
      const membership = await membershipService.updateMembershipRole({
        societyId: request.params.societyId,
        actor: request.auth.user,
        membershipId: request.params.membershipId,
        role: request.validated.body.role,
        request,
      });
      return sendSuccess(request, response, { membership });
    },
  };
}

module.exports = { createMembershipController };

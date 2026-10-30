const { sendError } = require('../utils/apiResponse');

function requireSocietyContext({ models, audit }) {
  return async function establishSocietyContext(request, response, next) {
    const sessionSocietyId = request.auth.session.activeSocietyId
      ? String(request.auth.session.activeSocietyId)
      : null;
    const requestedSocietyId = request.params.societyId;
    const suppliedSocietyId =
      request.get('x-society-id') ?? request.query.societyId ?? request.body?.societyId;

    if (
      suppliedSocietyId !== undefined ||
      !sessionSocietyId ||
      !requestedSocietyId ||
      sessionSocietyId !== requestedSocietyId
    ) {
      await audit.record({
        actorId: request.auth.user._id,
        societyId: sessionSocietyId,
        action: 'auth.society.access.denied',
        targetType: 'society',
        targetId: sessionSocietyId,
        outcome: 'failure',
        requestId: request.id,
        metadata: { reason: 'society_context_mismatch', method: request.method },
      });
      return sendError(request, response, {
        statusCode: 404,
        code: 'society_not_found',
        message: 'The requested society is not available',
      });
    }

    const society = await models.Society.findById(sessionSocietyId);
    const membership =
      society?.status === 'active'
        ? await models.SocietyMembership.findOne({
            societyId: society._id,
            userId: request.auth.user._id,
            status: 'active',
          })
        : null;

    if (!society || !membership) {
      if (
        request.auth.session.activeSocietyId &&
        (!society || society.status === 'archived' || (society.status === 'active' && !membership))
      ) {
        request.auth.session.activeSocietyId = null;
        await request.auth.session.save();
      }
      await audit.record({
        actorId: request.auth.user._id,
        societyId: sessionSocietyId,
        action: 'auth.society.access.denied',
        targetType: 'society',
        targetId: sessionSocietyId,
        outcome: 'failure',
        requestId: request.id,
        metadata: { reason: 'society_or_membership_unavailable', method: request.method },
      });
      return sendError(request, response, {
        statusCode: 403,
        code: 'active_membership_required',
        message: 'An active society membership is required',
      });
    }

    request.society = society;
    request.membership = membership;
    return next();
  };
}

module.exports = { requireSocietyContext };

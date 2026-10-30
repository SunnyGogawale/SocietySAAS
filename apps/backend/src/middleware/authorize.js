const { sendError } = require('../utils/apiResponse');

const ROLE_PERMISSIONS = Object.freeze({
  society_admin: new Set(['members:read', 'members:invite', 'members:manage']),
  house_owner: new Set(['profile:read']),
});

function requirePermissions(audit, ...requiredPermissions) {
  return async function authorize(request, response, next) {
    const user = request.auth?.user;
    const membership = request.membership;
    const platformPermissions = new Set(
      user?.platformRole === 'super_admin' ? ['platform:societies:create'] : [],
    );
    const membershipPermissions = membership
      ? new Set([...(ROLE_PERMISSIONS[membership.role] ?? []), ...(membership.permissions ?? [])])
      : new Set();
    const permissions = membership ? membershipPermissions : platformPermissions;

    if (requiredPermissions.every((permission) => permissions.has(permission))) return next();
    await audit?.record({
      actorId: user?._id ?? null,
      societyId: request.society?._id ?? null,
      action: 'auth.permission.denied',
      targetType: request.society ? 'society' : 'platform',
      targetId: request.society?._id ?? null,
      outcome: 'failure',
      requestId: request.id,
      metadata: { requiredPermissions, method: request.method },
    });
    return sendError(request, response, {
      statusCode: 403,
      code: 'permission_denied',
      message: 'You do not have permission to perform this action',
    });
  };
}

module.exports = { ROLE_PERMISSIONS, requirePermissions };

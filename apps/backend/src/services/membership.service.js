const { AppError } = require('../utils/AppError');
const { createRawToken, hashToken } = require('../utils/securityToken');
const { toPublicUser } = require('./auth.service');

function createMembershipService({ models, audit, mailer, config, clock = () => new Date() }) {
  const { Society, SocietyMembership, User } = models;

  async function createSociety({ name, slug, request, actor }) {
    const society = await Society.create({
      name: name.trim(),
      slug: slug.trim().toLowerCase(),
      status: 'active',
    });
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'society.create',
      targetType: 'society',
      targetId: society._id,
      outcome: 'success',
      requestId: request.id,
    });
    return {
      id: String(society._id),
      name: society.name,
      slug: society.slug,
      status: society.status,
    };
  }

  async function inviteMember({
    society: suppliedSociety,
    societyId,
    actor,
    role,
    email,
    request,
  }) {
    if (!mailer.available) {
      throw new AppError(503, 'email_delivery_unavailable', 'Email delivery is not configured');
    }

    const society =
      suppliedSociety ?? (await Society.findOne({ _id: societyId, status: 'active' }));
    if (!society) {
      throw new AppError(404, 'society_not_found', 'The requested society is not available');
    }

    const normalizedEmail = email.trim().toLowerCase();
    let user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      user = await User.create({
        email: normalizedEmail,
        displayName: `Invited member`,
        accountStatus: 'invited',
        platformRole: 'user',
      });
    }

    let membership = await SocietyMembership.findOne({
      societyId: society._id,
      userId: user._id,
    });
    if (membership?.status === 'active' || membership?.status === 'pending_verification') {
      throw new AppError(409, 'membership_exists', 'This user already has a society membership');
    }
    if (membership && membership.role !== role && membership.status !== 'revoked') {
      throw new AppError(
        409,
        'membership_role_conflict',
        'Resolve the existing membership before re-inviting',
      );
    }

    const invitationToken = createRawToken();
    const invitationExpiresAt = new Date(clock().getTime() + config.invitationTtlHours * 3600000);
    if (!membership) {
      membership = new SocietyMembership({
        societyId: society._id,
        userId: user._id,
      });
    }
    membership.role = role;
    membership.status = 'invited';
    membership.permissions = [];
    membership.invitedBy = actor._id;
    membership.revokedAt = null;
    membership.invitationTokenHash = hashToken(invitationToken);
    membership.invitationExpiresAt = invitationExpiresAt;
    await membership.save();

    try {
      await mailer.sendInvitation({
        to: user.email,
        token: invitationToken,
        societyName: society.name,
        role: role === 'society_admin' ? 'Society Admin' : 'House Owner',
      });
    } catch (error) {
      membership.invitationTokenHash = null;
      membership.invitationExpiresAt = null;
      membership.status = 'expired';
      await membership.save();
      throw error;
    }

    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'membership.invite',
      targetType: 'membership',
      targetId: membership._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { role },
    });

    return {
      id: String(membership._id),
      email: user.email,
      role: membership.role,
      status: membership.status,
      invitationExpiresAt: membership.invitationExpiresAt,
    };
  }

  async function listMemberships({ society, status, page, limit }) {
    const filter = { societyId: society._id };
    if (status) filter.status = status;
    const [memberships, total] = await Promise.all([
      SocietyMembership.find(filter)
        .sort({ createdAt: -1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      SocietyMembership.countDocuments(filter),
    ]);
    const users = await User.find({
      _id: { $in: memberships.map((membership) => membership.userId) },
    }).lean();
    const usersById = new Map(users.map((user) => [String(user._id), user]));
    return {
      memberships: memberships.map((membership) => ({
        id: String(membership._id),
        role: membership.role,
        status: membership.status,
        user: usersById.has(String(membership.userId))
          ? toPublicUser(usersById.get(String(membership.userId)))
          : null,
        createdAt: membership.createdAt,
        verifiedAt: membership.verifiedAt ?? null,
        revokedAt: membership.revokedAt ?? null,
      })),
      pagination: { page, limit, total, pageCount: Math.ceil(total / limit) },
    };
  }

  async function updateMembershipStatus({ society, actor, membershipId, status, request }) {
    if (!['active', 'suspended', 'revoked'].includes(status)) {
      throw new AppError(422, 'invalid_membership_status', 'Membership status is not allowed');
    }

    const membership = await SocietyMembership.findOne({
      _id: membershipId,
      societyId: society._id,
    });
    if (!membership || String(membership.userId) === String(actor._id)) {
      throw new AppError(404, 'membership_not_found', 'The requested membership was not found');
    }
    if (membership.role === 'society_admin') {
      throw new AppError(
        403,
        'permission_denied',
        'Society Admin memberships require platform access',
      );
    }
    if (membership.status === 'invited' || membership.status === 'expired') {
      throw new AppError(409, 'membership_not_accepted', 'The invitation must be accepted first');
    }
    if (status === 'active' && config.emailVerificationRequired) {
      const targetUser = await User.findById(membership.userId);
      if (!targetUser?.emailVerifiedAt) {
        throw new AppError(
          409,
          'email_verification_required',
          'The member must verify their email before access is activated',
        );
      }
    }

    const previousStatus = membership.status;
    membership.status = status;
    membership.revokedAt = status === 'revoked' ? clock() : null;
    membership.verifiedBy = status === 'active' ? actor._id : membership.verifiedBy;
    membership.verifiedAt = status === 'active' ? clock() : membership.verifiedAt;
    await membership.save();
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'membership.status.change',
      targetType: 'membership',
      targetId: membership._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { previousStatus, status },
    });

    return {
      id: String(membership._id),
      role: membership.role,
      status: membership.status,
      revokedAt: membership.revokedAt,
    };
  }

  async function updateMembershipRole({ societyId, actor, membershipId, role, request }) {
    const membership = await SocietyMembership.findOne({
      _id: membershipId,
      societyId,
    });
    if (!membership || membership.status === 'revoked' || membership.status === 'expired') {
      throw new AppError(404, 'membership_not_found', 'The requested membership was not found');
    }
    const previousRole = membership.role;
    membership.role = role;
    membership.permissions = [];
    await membership.save();
    await audit.record({
      actorId: actor._id,
      societyId,
      action: 'membership.role.change',
      targetType: 'membership',
      targetId: membership._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { previousRole, role },
    });
    return {
      id: String(membership._id),
      role: membership.role,
      status: membership.status,
    };
  }

  return {
    createSociety,
    inviteMember,
    listMemberships,
    updateMembershipRole,
    updateMembershipStatus,
  };
}

module.exports = { createMembershipService };

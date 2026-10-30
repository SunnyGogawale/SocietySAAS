const { randomBytes } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { AppError } = require('../utils/AppError');
const { hashToken, createRawToken } = require('../utils/securityToken');
const { comparePassword, hashPassword, validatePasswordPolicy } = require('../utils/password');

const DUMMY_PASSWORD_HASH = bcrypt.hashSync('invalid-account-password-placeholder', 12);

function objectIdString(value) {
  return value == null ? null : String(value);
}

function toPublicUser(user) {
  return {
    id: objectIdString(user._id),
    email: user.email,
    displayName: user.displayName,
    phone: user.phone ?? null,
    platformRole: user.platformRole,
    emailVerified: Boolean(user.emailVerifiedAt),
  };
}

function toPublicSociety(society, membership) {
  return {
    id: objectIdString(society._id),
    name: society.name,
    slug: society.slug,
    role: membership.role,
    permissions: membership.permissions ?? [],
  };
}

function createAuthService({ models, audit, mailer, config, logger, clock = () => new Date() }) {
  const { Session, Society, SocietyMembership, User } = models;

  async function findPasswordUser(email) {
    return User.findOne({ email }).select('+passwordHash');
  }

  async function getAvailableSocieties(userId) {
    const memberships = await SocietyMembership.find({ userId, status: 'active' }).lean();
    const results = [];

    for (const membership of memberships) {
      const society = await Society.findOne({ _id: membership.societyId, status: 'active' }).lean();
      if (society) results.push(toPublicSociety(society, membership));
    }

    return results.sort((left, right) => left.name.localeCompare(right.name));
  }

  async function createSession({ user, request, transport }) {
    const sessionToken = createRawToken();
    const csrfToken = randomBytes(32).toString('base64url');
    const societies = await getAvailableSocieties(user._id);
    const activeSocietyId = societies.length === 1 ? societies[0].id : null;
    const now = clock();
    const session = await Session.create({
      userId: user._id,
      tokenHash: hashToken(sessionToken),
      csrfTokenHash: hashToken(csrfToken),
      transport,
      activeSocietyId,
      expiresAt: new Date(now.getTime() + config.sessionTtlDays * 86400000),
      lastUsedAt: now,
      userAgent: String(request.get('user-agent') ?? '').slice(0, 512),
    });

    return {
      session,
      sessionToken,
      csrfToken,
      societies,
      activeSociety: societies.find((society) => society.id === activeSocietyId) ?? null,
    };
  }

  async function login({ email, password, request, transport = 'cookie' }) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await findPasswordUser(normalizedEmail);
    const passwordMatches = await comparePassword(
      password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    const accountEnabled = user?.accountStatus === 'active';

    if (!user || !accountEnabled || !passwordMatches) {
      await audit.record({
        actorId: user?._id ?? null,
        action: 'auth.login',
        targetType: 'user',
        targetId: user?._id ?? null,
        outcome: 'failure',
        requestId: request.id,
        metadata: { reason: 'credentials_rejected' },
      });
      throw new AppError(401, 'invalid_credentials', 'Invalid email or password');
    }

    if (config.emailVerificationRequired && !user.emailVerifiedAt) {
      await audit.record({
        actorId: user._id,
        action: 'auth.login',
        targetType: 'user',
        targetId: user._id,
        outcome: 'failure',
        requestId: request.id,
        metadata: { reason: 'email_verification_required' },
      });
      throw new AppError(403, 'email_verification_required', 'Verify your email before signing in');
    }

    const sessionData = await createSession({ user, request, transport });
    await audit.record({
      actorId: user._id,
      action: 'auth.login',
      targetType: 'session',
      targetId: sessionData.session._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { transport },
    });

    return {
      user: toPublicUser(user),
      sessionToken: sessionData.sessionToken,
      csrfToken: sessionData.csrfToken,
      societies: sessionData.societies,
      activeSociety: sessionData.activeSociety,
      expiresAt: sessionData.session.expiresAt,
    };
  }

  async function authenticate(token) {
    if (!token || token.length > 256) return null;

    const now = clock();
    const session = await Session.findOne({
      tokenHash: hashToken(token),
      revokedAt: null,
      expiresAt: { $gt: now },
    }).select('+tokenHash +csrfTokenHash');

    if (!session) return null;

    const user = await User.findOne({ _id: session.userId, accountStatus: 'active' });
    if (!user) return null;

    if (session.activeSocietyId) {
      const membership = await SocietyMembership.findOne({
        userId: user._id,
        societyId: session.activeSocietyId,
        status: 'active',
      });
      const society = membership
        ? await Society.findOne({ _id: session.activeSocietyId, status: 'active' })
        : null;

      if (!membership || !society) {
        session.activeSocietyId = null;
        await session.save();
      }
    }

    session.lastUsedAt = now;
    await session.save();

    return { session, user };
  }

  async function logout({ session, request }) {
    if (session.revokedAt) return;
    session.revokedAt = clock();
    await session.save();
    await audit.record({
      actorId: session.userId,
      societyId: session.activeSocietyId,
      action: 'auth.logout',
      targetType: 'session',
      targetId: session._id,
      outcome: 'success',
      requestId: request.id,
    });
  }

  async function listSocieties(userId) {
    return getAvailableSocieties(userId);
  }

  async function selectSociety({ user, session, societyId, request }) {
    const membership = await SocietyMembership.findOne({
      userId: user._id,
      societyId,
      status: 'active',
    });
    const society = membership
      ? await Society.findOne({ _id: societyId, status: 'active' }).lean()
      : null;

    if (!membership || !society) {
      await audit.record({
        actorId: user._id,
        societyId,
        action: 'auth.society.select',
        targetType: 'society',
        targetId: societyId,
        outcome: 'failure',
        requestId: request.id,
      });
      throw new AppError(404, 'society_not_found', 'The requested society is not available');
    }

    session.activeSocietyId = society._id;
    await session.save();
    await audit.record({
      actorId: user._id,
      societyId: society._id,
      action: 'auth.society.select',
      targetType: 'society',
      targetId: society._id,
      outcome: 'success',
      requestId: request.id,
    });
    return toPublicSociety(society, membership);
  }

  async function updateProfile({ user, request, displayName, phone }) {
    if (displayName !== undefined) user.displayName = displayName;
    if (phone !== undefined) user.phone = phone || undefined;
    await user.save();
    await audit.record({
      actorId: user._id,
      action: 'profile.update',
      targetType: 'user',
      targetId: user._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { changedFields: ['displayName', ...(phone !== undefined ? ['phone'] : [])] },
    });
    return toPublicUser(user);
  }

  async function requestPasswordReset({ email, request }) {
    const user = await findPasswordUser(email.trim().toLowerCase());
    if (!user || user.accountStatus !== 'active') {
      await audit.record({
        actorId: user?._id ?? null,
        action: 'auth.password_reset.request',
        targetType: 'user',
        targetId: user?._id ?? null,
        outcome: 'success',
        requestId: request.id,
        metadata: { result: 'generic_response' },
      });
      return;
    }

    if (!mailer.available) {
      logger.warn(
        { event: 'password_reset_delivery_unavailable' },
        'Password reset email not sent',
      );
      return;
    }

    const token = createRawToken();
    user.passwordResetTokenHash = hashToken(token);
    user.passwordResetExpiresAt = new Date(
      clock().getTime() + config.passwordResetTtlMinutes * 60000,
    );
    await user.save();

    try {
      await mailer.sendPasswordReset({ to: user.email, token });
      await audit.record({
        actorId: user._id,
        action: 'auth.password_reset.request',
        targetType: 'user',
        targetId: user._id,
        outcome: 'success',
        requestId: request.id,
      });
    } catch (error) {
      user.passwordResetTokenHash = null;
      user.passwordResetExpiresAt = null;
      await user.save();
      logger.warn(
        { requestId: request.id, deliveryError: error.code ?? 'unknown' },
        'Password reset email could not be sent',
      );
    }
  }

  async function resetPassword({ token, password, request }) {
    const user = await User.findOne({
      passwordResetTokenHash: hashToken(token),
      passwordResetExpiresAt: { $gt: clock() },
      accountStatus: 'active',
    }).select('+passwordHash +passwordResetTokenHash +passwordResetExpiresAt');

    if (!user || !validatePasswordPolicy(password)) {
      await audit.record({
        actorId: user?._id ?? null,
        action: 'auth.password_reset.complete',
        targetType: 'user',
        targetId: user?._id ?? null,
        outcome: 'failure',
        requestId: request.id,
        metadata: { reason: 'invalid_or_expired_token' },
      });
      throw new AppError(400, 'invalid_reset_token', 'The reset link is invalid or has expired');
    }

    const reset = await User.updateOne(
      {
        _id: user._id,
        passwordResetTokenHash: hashToken(token),
        passwordResetExpiresAt: { $gt: clock() },
        accountStatus: 'active',
      },
      {
        $set: {
          passwordHash: await hashPassword(password),
          passwordResetTokenHash: null,
          passwordResetExpiresAt: null,
        },
      },
    );
    if (reset.modifiedCount !== 1) {
      await audit.record({
        actorId: user._id,
        action: 'auth.password_reset.complete',
        targetType: 'user',
        targetId: user._id,
        outcome: 'failure',
        requestId: request.id,
        metadata: { reason: 'invalid_or_expired_token' },
      });
      throw new AppError(400, 'invalid_reset_token', 'The reset link is invalid or has expired');
    }

    await Session.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: clock() });
    await audit.record({
      actorId: user._id,
      action: 'auth.password_reset.complete',
      targetType: 'user',
      targetId: user._id,
      outcome: 'success',
      requestId: request.id,
    });
  }

  async function verifyEmail({ token, request }) {
    const user = await User.findOne({
      emailVerificationTokenHash: hashToken(token),
      emailVerificationExpiresAt: { $gt: clock() },
    }).select('+emailVerificationTokenHash +emailVerificationExpiresAt');

    if (!user || user.accountStatus === 'disabled') {
      await audit.record({
        actorId: user?._id ?? null,
        action: 'auth.email.verify',
        targetType: 'user',
        targetId: user?._id ?? null,
        outcome: 'failure',
        requestId: request.id,
      });
      throw new AppError(
        400,
        'invalid_verification_token',
        'The verification link is invalid or has expired',
      );
    }

    const verification = await User.updateOne(
      {
        _id: user._id,
        emailVerificationTokenHash: hashToken(token),
        emailVerificationExpiresAt: { $gt: clock() },
        accountStatus: { $ne: 'disabled' },
      },
      {
        $set: {
          emailVerifiedAt: clock(),
          emailVerificationTokenHash: null,
          emailVerificationExpiresAt: null,
        },
      },
    );
    if (verification.modifiedCount !== 1) {
      await audit.record({
        actorId: user._id,
        action: 'auth.email.verify',
        targetType: 'user',
        targetId: user._id,
        outcome: 'failure',
        requestId: request.id,
      });
      throw new AppError(
        400,
        'invalid_verification_token',
        'The verification link is invalid or has expired',
      );
    }

    await SocietyMembership.updateMany(
      { userId: user._id, role: 'society_admin', status: 'pending_verification' },
      { status: 'active', verifiedAt: clock(), verifiedBy: user._id },
    );
    await audit.record({
      actorId: user._id,
      action: 'auth.email.verify',
      targetType: 'user',
      targetId: user._id,
      outcome: 'success',
      requestId: request.id,
    });
  }

  async function acceptInvitation({ token, password, displayName, authenticatedUser, request }) {
    const invitationTokenHash = hashToken(token);
    const membership = await SocietyMembership.findOne({
      invitationTokenHash,
      invitationExpiresAt: { $gt: clock() },
      status: 'invited',
    }).select('+invitationTokenHash +invitationExpiresAt');

    if (!membership) {
      await audit.record({
        actorId: authenticatedUser?._id ?? null,
        action: 'auth.invitation.accept',
        societyId: null,
        targetType: 'membership',
        outcome: 'failure',
        requestId: request.id,
        metadata: { reason: 'invalid_or_expired_invitation' },
      });
      throw new AppError(400, 'invalid_invitation', 'The invitation is invalid or has expired');
    }

    const user = await User.findById(membership.userId).select('+passwordHash');
    if (!user || user.accountStatus === 'disabled') {
      throw new AppError(400, 'invalid_invitation', 'The invitation is invalid or has expired');
    }

    if (user.accountStatus === 'active') {
      if (
        (!authenticatedUser ||
          objectIdString(authenticatedUser._id) !== objectIdString(user._id)) &&
        !config.emailVerificationRequired
      ) {
        throw new AppError(
          409,
          'sign_in_to_accept',
          'Sign in to the invited account before accepting this invitation',
        );
      }
    } else {
      if (!validatePasswordPolicy(password) || !displayName) {
        throw new AppError(422, 'weak_password', 'Password must be between 12 and 128 characters');
      }
      user.passwordHash = await hashPassword(password);
      user.displayName = displayName.trim();
      user.accountStatus = 'active';
    }

    const claimedMembership = await SocietyMembership.findOneAndUpdate(
      {
        _id: membership._id,
        invitationTokenHash,
        invitationExpiresAt: { $gt: clock() },
        status: 'invited',
      },
      { $set: { invitationTokenHash: null, invitationExpiresAt: null } },
      { returnDocument: 'after' },
    );
    if (!claimedMembership) {
      await audit.record({
        actorId: authenticatedUser?._id ?? null,
        action: 'auth.invitation.accept',
        societyId: membership.societyId,
        targetType: 'membership',
        targetId: membership._id,
        outcome: 'failure',
        requestId: request.id,
        metadata: { reason: 'invalid_or_expired_invitation' },
      });
      throw new AppError(400, 'invalid_invitation', 'The invitation is invalid or has expired');
    }

    try {
      const verificationRequired = config.emailVerificationRequired && !user.emailVerifiedAt;
      if (verificationRequired && mailer.available) {
        const verificationToken = createRawToken();
        user.emailVerificationTokenHash = hashToken(verificationToken);
        user.emailVerificationExpiresAt = new Date(clock().getTime() + 86400000);
        await mailer.sendEmailVerification({ to: user.email, token: verificationToken });
      }
      await user.save();

      if (verificationRequired || membership.role === 'house_owner') {
        membership.status = 'pending_verification';
      } else {
        membership.status = 'active';
        membership.verifiedAt = clock();
      }
      await membership.save();
      await audit.record({
        actorId: user._id,
        societyId: membership.societyId,
        action: 'auth.invitation.accept',
        targetType: 'membership',
        targetId: membership._id,
        outcome: 'success',
        requestId: request.id,
        metadata: { role: membership.role, status: membership.status },
      });

      return {
        user: toPublicUser(user),
        membershipStatus: membership.status,
        emailVerificationRequired: verificationRequired,
      };
    } catch (error) {
      await SocietyMembership.updateOne(
        { _id: membership._id, status: 'invited', invitationTokenHash: null },
        {
          $set: {
            invitationTokenHash,
            invitationExpiresAt: membership.invitationExpiresAt,
          },
        },
      );
      throw error;
    }
  }

  return {
    acceptInvitation,
    authenticate,
    createSession,
    listSocieties,
    login,
    logout,
    requestPasswordReset,
    resetPassword,
    selectSociety,
    updateProfile,
    verifyEmail,
  };
}

module.exports = { createAuthService, toPublicSociety, toPublicUser };

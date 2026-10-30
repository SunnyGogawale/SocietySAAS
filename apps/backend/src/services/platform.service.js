const { AppError } = require('../utils/AppError');

const SOCIETY_STATUSES = [
  'pending_review',
  'provisioning',
  'rejected',
  'active',
  'suspended',
  'archived',
];
const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'suspended', 'canceled'];
const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const EXPORT_LIMIT = 5000;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(headers, rows) {
  return [headers.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))].join(
    '\r\n',
  );
}

function createPlatformService({
  models,
  audit,
  membershipService,
  mailer,
  healthService,
  clock = () => new Date(),
}) {
  const {
    AuditLog,
    Society,
    SocietyMembership,
    Subscription,
    SubscriptionPlan,
    SupportTicket,
    User,
  } = models;

  function pageOptions(page, limit) {
    return { skip: (page - 1) * limit, limit };
  }

  async function getDashboard() {
    const now = clock();
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [societyGroups, subscriptionGroups, plans, openTickets, recentErrors, health] =
      await Promise.all([
        Society.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
        Subscription.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
        SubscriptionPlan.find({ status: 'active' }).select('name code').sort({ name: 1 }).lean(),
        SupportTicket.countDocuments({ status: { $in: ['open', 'in_progress'] } }),
        AuditLog.countDocuments({ outcome: 'failure', occurredAt: { $gte: since } }),
        Promise.resolve(healthService.getHealth()),
      ]);
    const societiesByStatus = Object.fromEntries(
      societyGroups.map(({ _id, count }) => [_id, count]),
    );
    const subscriptionsByStatus = Object.fromEntries(
      subscriptionGroups.map(({ _id, count }) => [_id, count]),
    );
    const planSummaries = await Promise.all(
      plans.map(async (plan) => ({
        id: String(plan._id),
        code: plan.code,
        name: plan.name,
        tenants: await Subscription.countDocuments({
          planId: plan._id,
          status: { $nin: ['canceled'] },
        }),
      })),
    );
    return {
      societies: {
        total: Object.values(societiesByStatus).reduce((sum, count) => sum + count, 0),
        active: societiesByStatus.active ?? 0,
        suspended: societiesByStatus.suspended ?? 0,
        pendingReview: societiesByStatus.pending_review ?? 0,
        provisioning: societiesByStatus.provisioning ?? 0,
        rejected: societiesByStatus.rejected ?? 0,
        archived: societiesByStatus.archived ?? 0,
      },
      subscriptions: {
        total: Object.values(subscriptionsByStatus).reduce((sum, count) => sum + count, 0),
        trialing: subscriptionsByStatus.trialing ?? 0,
        active: subscriptionsByStatus.active ?? 0,
        pastDue: subscriptionsByStatus.past_due ?? 0,
        suspended: subscriptionsByStatus.suspended ?? 0,
        canceled: subscriptionsByStatus.canceled ?? 0,
        plans: planSummaries,
      },
      support: { openTickets },
      operations: {
        status: health.status,
        database: health.database,
        uptimeSeconds: health.uptimeSeconds,
        failuresLast24Hours: recentErrors,
      },
    };
  }

  function societyFilter({ status, q }) {
    const filter = {};
    if (status) filter.status = status;
    if (q) {
      const regex = new RegExp(escapeRegex(q), 'i');
      filter.$or = [
        { name: regex },
        { slug: regex },
        { contactEmail: regex },
        { registrationNumber: regex },
      ];
    }
    return filter;
  }

  async function attachSocietySummaries(societies) {
    const ids = societies.map((society) => society._id);
    const [subscriptions, memberships] = await Promise.all([
      Subscription.find({ societyId: { $in: ids } })
        .populate('planId', 'name code')
        .lean(),
      SocietyMembership.find({
        _id: { $in: societies.map((society) => society.primaryAdminMembershipId).filter(Boolean) },
      }).lean(),
    ]);
    const users = await User.find({
      _id: { $in: memberships.map((membership) => membership.userId) },
    })
      .select('displayName email')
      .lean();
    const usersById = new Map(users.map((user) => [String(user._id), user]));
    const membershipById = new Map(
      memberships.map((membership) => [String(membership._id), membership]),
    );
    const subscriptionBySociety = new Map(
      subscriptions.map((subscription) => [String(subscription.societyId), subscription]),
    );
    return societies.map((society) => {
      const membership = society.primaryAdminMembershipId
        ? membershipById.get(String(society.primaryAdminMembershipId))
        : null;
      const subscription = subscriptionBySociety.get(String(society._id));
      const primaryAdmin = membership ? usersById.get(String(membership.userId)) : null;
      return {
        ...society,
        id: String(society._id),
        primaryAdmin: primaryAdmin
          ? {
              membershipId: String(membership._id),
              displayName: primaryAdmin.displayName,
              email: primaryAdmin.email,
              status: membership.status,
            }
          : null,
        subscription: subscription
          ? {
              id: String(subscription._id),
              status: subscription.status,
              plan: subscription.planId
                ? { id: String(subscription.planId._id), name: subscription.planId.name }
                : null,
              trialEndsAt: subscription.trialEndsAt,
              limits: subscription.limits,
            }
          : null,
      };
    });
  }

  async function listSocieties({ status, q, sort = 'createdAt', direction = 'desc', page, limit }) {
    const filter = societyFilter({ status, q });
    const [records, total] = await Promise.all([
      Society.find(filter)
        .sort({ [sort]: direction === 'asc' ? 1 : -1, _id: 1 })
        .skip(pageOptions(page, limit).skip)
        .limit(limit)
        .lean(),
      Society.countDocuments(filter),
    ]);
    return {
      societies: await attachSocietySummaries(records),
      pagination: { page, limit, total, pageCount: Math.ceil(total / limit) },
    };
  }

  async function getSociety(societyId) {
    const society = await Society.findById(societyId).lean();
    if (!society)
      throw new AppError(404, 'society_not_found', 'The requested society was not found');
    const [summary] = await attachSocietySummaries([society]);
    const [adminMemberships, subscription] = await Promise.all([
      SocietyMembership.find({ societyId, role: 'society_admin' }).lean(),
      Subscription.findOne({ societyId }).populate('planId').lean(),
    ]);
    const admins = await User.find({
      _id: { $in: adminMemberships.map((membership) => membership.userId) },
    })
      .select('displayName email')
      .lean();
    const adminsById = new Map(admins.map((admin) => [String(admin._id), admin]));
    return {
      society: {
        ...summary,
        admins: adminMemberships.map((membership) => ({
          membershipId: String(membership._id),
          displayName: adminsById.get(String(membership.userId))?.displayName ?? null,
          email: adminsById.get(String(membership.userId))?.email ?? null,
          status: membership.status,
          primary: String(membership._id) === String(society.primaryAdminMembershipId),
        })),
        subscription: subscription
          ? {
              id: String(subscription._id),
              plan: subscription.planId
                ? { id: String(subscription.planId._id), name: subscription.planId.name }
                : null,
              status: subscription.status,
              trialEndsAt: subscription.trialEndsAt,
              currentPeriodEndsAt: subscription.currentPeriodEndsAt,
              limits: subscription.limits,
            }
          : null,
      },
    };
  }

  async function submitRegistration(input, request) {
    const society = await Society.create({
      ...input,
      status: 'pending_review',
    });
    await audit.record({
      action: 'society.registration.submit',
      societyId: society._id,
      targetType: 'society',
      targetId: society._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { slug: society.slug },
    });
    return {
      id: String(society._id),
      name: society.name,
      status: society.status,
      createdAt: society.createdAt,
    };
  }

  async function approveRegistration({ societyId, planId, trialDays, actor, request }) {
    const society = await Society.findById(societyId);
    if (!society || !['pending_review', 'provisioning'].includes(society.status)) {
      throw new AppError(
        409,
        'registration_not_approvable',
        'The society registration cannot be approved',
      );
    }
    const plan = await SubscriptionPlan.findOne({ _id: planId, status: 'active' }).lean();
    if (!plan)
      throw new AppError(404, 'subscription_plan_not_found', 'The active plan was not found');
    if (!mailer.available) {
      throw new AppError(503, 'email_delivery_unavailable', 'Email delivery is not configured');
    }
    if (!society.contactEmail) {
      throw new AppError(
        422,
        'primary_admin_email_required',
        'A contact email is required before provisioning a Society Admin',
      );
    }

    society.status = 'provisioning';
    await society.save();
    const now = clock();
    const trialEndsAt = trialDays > 0 ? new Date(now.getTime() + trialDays * 86400000) : null;
    const subscription = await Subscription.findOneAndUpdate(
      { societyId: society._id },
      {
        $set: {
          planId: plan._id,
          status: trialDays > 0 ? 'trialing' : 'active',
          trialEndsAt,
          limits: plan.limits,
          configuredBy: actor._id,
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    const membership = await membershipService.inviteMember({
      society,
      actor,
      role: 'society_admin',
      email: society.contactEmail,
      request,
    });
    society.status = 'active';
    society.reviewedAt = now;
    society.reviewedBy = actor._id;
    society.rejectionReason = null;
    society.primaryAdminMembershipId = membership.id;
    await society.save();
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'society.registration.approve',
      targetType: 'society',
      targetId: society._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { planId: String(plan._id), subscriptionId: String(subscription._id), trialDays },
    });
    return getSociety(societyId);
  }

  async function rejectRegistration({ societyId, reason, actor, request }) {
    const society = await Society.findOne({ _id: societyId, status: 'pending_review' });
    if (!society) {
      throw new AppError(
        409,
        'registration_not_rejectable',
        'The society registration cannot be rejected',
      );
    }
    society.status = 'rejected';
    society.rejectionReason = reason;
    society.reviewedAt = clock();
    society.reviewedBy = actor._id;
    await society.save();
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'society.registration.reject',
      targetType: 'society',
      targetId: society._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { reason },
    });
    return { id: String(society._id), status: society.status, rejectionReason: reason };
  }

  async function updateSocietyProfile({ societyId, changes, actor, request }) {
    const society = await Society.findById(societyId);
    if (!society)
      throw new AppError(404, 'society_not_found', 'The requested society was not found');
    const previous = {};
    for (const [key, value] of Object.entries(changes)) {
      previous[key] = society[key];
      society[key] = value;
    }
    await society.save();
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'society.profile.update',
      targetType: 'society',
      targetId: society._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { changedFields: Object.keys(changes), previousName: previous.name },
    });
    return getSociety(societyId);
  }

  async function inviteSocietyAdmin({ societyId, email, actor, request }) {
    const society = await Society.findOne({ _id: societyId, status: 'active' });
    if (!society) throw new AppError(404, 'society_not_found', 'The active society was not found');
    return membershipService.inviteMember({
      society,
      actor,
      role: 'society_admin',
      email,
      request,
    });
  }

  async function changeSocietyStatus({ societyId, status, actor, request }) {
    if (!['active', 'suspended', 'archived'].includes(status)) {
      throw new AppError(422, 'invalid_society_status', 'Society status is not allowed');
    }
    const society = await Society.findById(societyId);
    if (!society)
      throw new AppError(404, 'society_not_found', 'The requested society was not found');
    const allowed =
      (society.status === 'active' && ['suspended', 'archived'].includes(status)) ||
      (society.status === 'suspended' && ['active', 'archived'].includes(status));
    if (!allowed) {
      throw new AppError(
        409,
        'invalid_society_transition',
        'The society cannot transition to that status',
      );
    }
    const previousStatus = society.status;
    society.status = status;
    society.archivedAt = status === 'archived' ? clock() : null;
    await society.save();
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: `society.${status}`,
      targetType: 'society',
      targetId: society._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { previousStatus, status },
    });
    return { id: String(society._id), status: society.status, archivedAt: society.archivedAt };
  }

  async function setPrimaryAdmin({ societyId, membershipId, actor, request }) {
    const [society, membership] = await Promise.all([
      Society.findById(societyId),
      SocietyMembership.findOne({
        _id: membershipId,
        societyId,
        role: 'society_admin',
        status: 'active',
      }),
    ]);
    if (!society)
      throw new AppError(404, 'society_not_found', 'The requested society was not found');
    if (!membership) {
      throw new AppError(
        404,
        'admin_membership_not_found',
        'An active Society Admin was not found',
      );
    }
    const previousMembershipId = society.primaryAdminMembershipId;
    society.primaryAdminMembershipId = membership._id;
    await society.save();
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'society.primary_admin.change',
      targetType: 'membership',
      targetId: membership._id,
      outcome: 'success',
      requestId: request.id,
      metadata: {
        previousMembershipId: previousMembershipId ? String(previousMembershipId) : null,
      },
    });
    return getSociety(societyId);
  }

  async function listPlans({ includeArchived = false } = {}) {
    const filter = includeArchived ? {} : { status: 'active' };
    const plans = await SubscriptionPlan.find(filter).sort({ name: 1 }).lean();
    const usage = await Subscription.aggregate([
      { $group: { _id: '$planId', count: { $sum: 1 } } },
    ]);
    const usageByPlan = new Map(usage.map((row) => [String(row._id), row.count]));
    return {
      plans: plans.map((plan) => ({
        ...plan,
        id: String(plan._id),
        subscribers: usageByPlan.get(String(plan._id)) ?? 0,
      })),
    };
  }

  async function createPlan(input, actor, request) {
    const plan = await SubscriptionPlan.create(input);
    await audit.record({
      actorId: actor._id,
      action: 'subscription_plan.create',
      targetType: 'subscription_plan',
      targetId: plan._id,
      outcome: 'success',
      requestId: request.id,
    });
    return { plan: { ...plan.toObject(), id: String(plan._id) } };
  }

  async function updatePlan({ planId, changes, actor, request }) {
    const plan = await SubscriptionPlan.findById(planId);
    if (!plan) throw new AppError(404, 'subscription_plan_not_found', 'The plan was not found');
    if (plan.status === 'archived' && changes.status !== 'active') {
      throw new AppError(409, 'plan_archived', 'An archived plan cannot be edited');
    }
    const nextPrice = Object.hasOwn(changes, 'priceMinor') ? changes.priceMinor : plan.priceMinor;
    const nextCurrency = Object.hasOwn(changes, 'currency') ? changes.currency : plan.currency;
    if (nextPrice !== null && nextCurrency === null) {
      throw new AppError(
        422,
        'plan_currency_required',
        'Currency is required when a plan has a price',
      );
    }
    const updated = { ...changes };
    if (changes.limits) {
      updated.limits = { ...(plan.limits?.toObject?.() ?? {}), ...changes.limits };
    }
    Object.assign(plan, updated);
    await plan.save();
    if (changes.limits) {
      await Subscription.updateMany(
        { planId: plan._id },
        { $set: { limits: plan.limits.toObject() } },
      );
    }
    await audit.record({
      actorId: actor._id,
      action: 'subscription_plan.update',
      targetType: 'subscription_plan',
      targetId: plan._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { changedFields: Object.keys(changes) },
    });
    return { plan: { ...plan.toObject(), id: String(plan._id) } };
  }

  async function updateSubscription({ societyId, changes, actor, request }) {
    const society = await Society.findById(societyId);
    if (!society)
      throw new AppError(404, 'society_not_found', 'The requested society was not found');
    const subscription = await Subscription.findOne({ societyId });
    if (!subscription) {
      throw new AppError(404, 'subscription_not_found', 'The society has no subscription');
    }
    const previous = { planId: String(subscription.planId), status: subscription.status };
    if (changes.planId) {
      const plan = await SubscriptionPlan.findOne({ _id: changes.planId, status: 'active' });
      if (!plan)
        throw new AppError(404, 'subscription_plan_not_found', 'The active plan was not found');
      subscription.planId = plan._id;
      subscription.limits = plan.limits;
    }
    if (changes.status === 'trialing' && changes.trialDays === 0) {
      throw new AppError(
        422,
        'trial_period_required',
        'A trialing subscription requires a positive trial period',
      );
    }
    if (
      changes.status === 'trialing' &&
      changes.trialDays === undefined &&
      !subscription.trialEndsAt
    ) {
      throw new AppError(
        422,
        'trial_period_required',
        'A trialing subscription requires a trial end date',
      );
    }
    if (changes.status) subscription.status = changes.status;
    if (changes.trialDays !== undefined) {
      subscription.trialEndsAt =
        changes.trialDays > 0 ? new Date(clock().getTime() + changes.trialDays * 86400000) : null;
      if (changes.trialDays > 0 && !changes.status) subscription.status = 'trialing';
      if (changes.trialDays === 0 && subscription.status === 'trialing' && !changes.status) {
        subscription.status = 'active';
      }
    }
    await subscription.save();
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'subscription.update',
      targetType: 'subscription',
      targetId: subscription._id,
      outcome: 'success',
      requestId: request.id,
      metadata: {
        previousPlanId: previous.planId,
        previousStatus: previous.status,
        planId: String(subscription.planId),
        status: subscription.status,
      },
    });
    return getSociety(societyId);
  }

  async function listAuditLogs({
    societyId,
    action,
    outcome,
    from,
    to,
    sort = 'occurredAt',
    direction = 'desc',
    page,
    limit,
  }) {
    const filter = {};
    if (societyId) filter.societyId = societyId;
    if (action) filter.action = action;
    if (outcome) filter.outcome = outcome;
    if (from || to) {
      filter.occurredAt = {};
      if (from) filter.occurredAt.$gte = new Date(from);
      if (to) filter.occurredAt.$lte = new Date(to);
    }
    const [records, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ [sort]: direction === 'asc' ? 1 : -1, _id: direction === 'asc' ? 1 : -1 })
        .skip(pageOptions(page, limit).skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);
    const actors = await User.find({
      _id: { $in: records.map((record) => record.actorId).filter(Boolean) },
    })
      .select('displayName')
      .lean();
    const actorById = new Map(actors.map((actor) => [String(actor._id), actor.displayName]));
    return {
      auditLogs: records.map((record) => ({
        id: String(record._id),
        actor: record.actorId
          ? (actorById.get(String(record.actorId)) ?? 'Unknown user')
          : 'System',
        societyId: record.societyId ? String(record.societyId) : null,
        action: record.action,
        targetType: record.targetType,
        targetId: record.targetId,
        outcome: record.outcome,
        requestId: record.requestId,
        metadata: record.metadata,
        occurredAt: record.occurredAt,
      })),
      pagination: { page, limit, total, pageCount: Math.ceil(total / limit) },
    };
  }

  async function exportAuditLogs({
    societyId,
    action,
    outcome,
    from,
    to,
    sort,
    direction,
    actor,
    request,
  }) {
    const result = await listAuditLogs({
      societyId,
      action,
      outcome,
      from,
      to,
      sort,
      direction,
      page: 1,
      limit: EXPORT_LIMIT,
    });
    const csv = toCsv(
      [
        'occurredAt',
        'actor',
        'societyId',
        'action',
        'targetType',
        'targetId',
        'outcome',
        'requestId',
      ],
      result.auditLogs.map((entry) => [
        entry.occurredAt?.toISOString(),
        entry.actor,
        entry.societyId,
        entry.action,
        entry.targetType,
        entry.targetId,
        entry.outcome,
        entry.requestId,
      ]),
    );
    const truncated = result.pagination.total > EXPORT_LIMIT;
    await audit.record({
      actorId: actor._id,
      action: 'platform.audit.export',
      targetType: 'audit_log',
      outcome: 'success',
      requestId: request.id,
      metadata: { exportedCount: result.auditLogs.length, truncated },
    });
    return { csv, truncated };
  }

  async function createSupportTicket({ society, actor, input, request }) {
    const ticket = await SupportTicket.create({
      societyId: society._id,
      createdBy: actor._id,
      ...input,
    });
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'support_ticket.create',
      targetType: 'support_ticket',
      targetId: ticket._id,
      outcome: 'success',
      requestId: request.id,
    });
    return { ticket: { id: String(ticket._id), subject: ticket.subject, status: ticket.status } };
  }

  async function listSupportTickets({
    societyId,
    status,
    q,
    sort = 'updatedAt',
    direction = 'desc',
    page,
    limit,
  }) {
    const filter = {};
    if (societyId) filter.societyId = societyId;
    if (status) filter.status = status;
    if (q) {
      const regex = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ subject: regex }, { description: regex }];
    }
    const [records, total] = await Promise.all([
      SupportTicket.find(filter)
        .sort({ [sort]: direction === 'asc' ? 1 : -1, _id: direction === 'asc' ? 1 : -1 })
        .skip(pageOptions(page, limit).skip)
        .limit(limit)
        .lean(),
      SupportTicket.countDocuments(filter),
    ]);
    const societyIds = [...new Set(records.map((record) => String(record.societyId)))];
    const [societies, assignees] = await Promise.all([
      Society.find({ _id: { $in: societyIds } })
        .select('name slug')
        .lean(),
      User.find({ _id: { $in: records.map((record) => record.assignedTo).filter(Boolean) } })
        .select('displayName email')
        .lean(),
    ]);
    const societyById = new Map(societies.map((society) => [String(society._id), society]));
    const assigneeById = new Map(assignees.map((user) => [String(user._id), user]));
    return {
      tickets: records.map((record) => ({
        id: String(record._id),
        societyId: String(record.societyId),
        society: societyById.get(String(record.societyId))?.name ?? 'Unknown society',
        subject: record.subject,
        description: record.description,
        status: record.status,
        priority: record.priority,
        assignedTo: record.assignedTo
          ? {
              id: String(record.assignedTo),
              displayName:
                assigneeById.get(String(record.assignedTo))?.displayName ?? 'Unknown admin',
            }
          : null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      })),
      pagination: { page, limit, total, pageCount: Math.ceil(total / limit) },
    };
  }

  async function updateSupportTicket({ ticketId, changes, actor, request }) {
    const ticket = await SupportTicket.findById(ticketId);
    if (!ticket)
      throw new AppError(404, 'support_ticket_not_found', 'The support ticket was not found');
    if (changes.assignedTo) {
      const assignee = await User.findOne({
        _id: changes.assignedTo,
        platformRole: 'super_admin',
        accountStatus: 'active',
      });
      if (!assignee) {
        throw new AppError(
          404,
          'support_assignee_not_found',
          'An active platform administrator was not found',
        );
      }
    }
    const previousStatus = ticket.status;
    ticket.status = changes.status;
    ticket.priority = changes.priority ?? ticket.priority;
    if (Object.hasOwn(changes, 'assignedTo')) ticket.assignedTo = changes.assignedTo;
    ticket.platformUpdatedBy = actor._id;
    ticket.resolvedAt = ['resolved', 'closed'].includes(changes.status) ? clock() : null;
    await ticket.save();
    await audit.record({
      actorId: actor._id,
      societyId: ticket.societyId,
      action: 'support_ticket.update',
      targetType: 'support_ticket',
      targetId: ticket._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { previousStatus, status: ticket.status, priority: ticket.priority },
    });
    return { ticket: { id: String(ticket._id), status: ticket.status, priority: ticket.priority } };
  }

  async function listSocietyTickets({ society, page, limit }) {
    return listSupportTickets({ societyId: society._id, page, limit });
  }

  async function exportSocieties({
    status,
    q,
    sort = 'createdAt',
    direction = 'desc',
    actor,
    request,
  }) {
    const filter = societyFilter({ status, q });
    const [records, total] = await Promise.all([
      Society.find(filter)
        .sort({ [sort]: direction === 'asc' ? 1 : -1, _id: direction === 'asc' ? 1 : -1 })
        .limit(EXPORT_LIMIT)
        .lean(),
      Society.countDocuments(filter),
    ]);
    const summaries = await attachSocietySummaries(records);
    const result = {
      csv: toCsv(
        [
          'name',
          'slug',
          'status',
          'contactEmail',
          'registrationNumber',
          'plan',
          'subscriptionStatus',
          'primaryAdmin',
        ],
        summaries.map((society) => [
          society.name,
          society.slug,
          society.status,
          society.contactEmail,
          society.registrationNumber,
          society.subscription?.plan?.name,
          society.subscription?.status,
          society.primaryAdmin?.email,
        ]),
      ),
      truncated: total > EXPORT_LIMIT,
    };
    await audit.record({
      actorId: actor._id,
      action: 'platform.societies.export',
      targetType: 'society',
      outcome: 'success',
      requestId: request.id,
      metadata: { exportedCount: summaries.length, truncated: result.truncated },
    });
    return result;
  }

  async function exportSupportTickets({ status, q, sort, direction, actor, request }) {
    const result = await listSupportTickets({
      status,
      q,
      sort,
      direction,
      page: 1,
      limit: EXPORT_LIMIT,
    });
    const exportResult = {
      csv: toCsv(
        ['society', 'subject', 'description', 'status', 'priority', 'createdAt', 'updatedAt'],
        result.tickets.map((ticket) => [
          ticket.society,
          ticket.subject,
          ticket.description,
          ticket.status,
          ticket.priority,
          ticket.createdAt?.toISOString(),
          ticket.updatedAt?.toISOString(),
        ]),
      ),
      truncated: result.pagination.total > EXPORT_LIMIT,
    };
    await audit.record({
      actorId: actor._id,
      action: 'platform.support_tickets.export',
      targetType: 'support_ticket',
      outcome: 'success',
      requestId: request.id,
      metadata: { exportedCount: result.tickets.length, truncated: exportResult.truncated },
    });
    return exportResult;
  }

  return {
    approveRegistration,
    changeSocietyStatus,
    createPlan,
    createSupportTicket,
    exportAuditLogs,
    exportSocieties,
    exportSupportTickets,
    getDashboard,
    getSociety,
    inviteSocietyAdmin,
    listAuditLogs,
    listPlans,
    listSocieties,
    listSocietyTickets,
    listSupportTickets,
    rejectRegistration,
    setPrimaryAdmin,
    submitRegistration,
    updatePlan,
    updateSocietyProfile,
    updateSubscription,
    updateSupportTicket,
  };
}

module.exports = {
  createPlatformService,
  SOCIETY_STATUSES,
  SUBSCRIPTION_STATUSES,
  TICKET_STATUSES,
};

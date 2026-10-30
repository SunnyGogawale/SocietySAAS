const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const pino = require('pino');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createApp } = require('../src/app');
const models = require('../src/models');
const { hashPassword } = require('../src/utils/password');
const { createRawToken, hashToken } = require('../src/utils/securityToken');

let mongo;
const delivery = { invitations: [], resets: [], verifications: [] };
const config = {
  nodeEnv: 'test',
  port: 4000,
  mongoUri: '',
  corsOrigins: ['http://localhost:5173'],
  requestBodyLimit: '1mb',
  sessionTtlDays: 7,
  passwordResetTtlMinutes: 60,
  invitationTtlHours: 24,
  emailVerificationRequired: false,
  webAppUrl: 'http://localhost:5173',
  emailFrom: 'test@example.invalid',
  smtp: null,
  authRateLimitWindowMs: 60000,
  authRateLimitMax: 100,
  logLevel: 'silent',
};
const logger = pino({ enabled: false });
const mailer = {
  available: true,
  async sendInvitation(message) {
    delivery.invitations.push(message);
  },
  async sendPasswordReset(message) {
    delivery.resets.push(message);
  },
  async sendEmailVerification(message) {
    delivery.verifications.push(message);
  },
};

let app;

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  const uri = await mongo.getUri();
  await mongoose.connect(uri);
  await Promise.all(Object.values(models).map((model) => model.init()));
  app = createApp({ config: { ...config, mongoUri: uri }, logger, models, mailer });
});

test.beforeEach(async () => {
  delivery.invitations.length = 0;
  delivery.resets.length = 0;
  delivery.verifications.length = 0;
  await Promise.all(Object.values(models).map((model) => model.collection.deleteMany({})));
});

test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

async function createUser({
  email,
  displayName = 'Test User',
  platformRole = 'user',
  password = 'correct horse battery',
  emailVerifiedAt = new Date(),
} = {}) {
  return models.User.create({
    email,
    displayName,
    passwordHash: await hashPassword(password),
    accountStatus: 'active',
    platformRole,
    emailVerifiedAt,
  });
}

async function createSociety(slug) {
  return models.Society.create({ name: slug, slug, status: 'active' });
}

async function addMembership(user, society, role = 'society_admin', status = 'active') {
  return models.SocietyMembership.create({
    userId: user._id,
    societyId: society._id,
    role,
    status,
    invitedBy: user._id,
    verifiedAt: status === 'active' ? new Date() : null,
  });
}

async function login(email, password = 'correct horse battery', transport = 'bearer') {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .set('x-session-transport', transport)
    .send({ email, password });
  return response;
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

async function createPlatformAdmin() {
  return createUser({
    email: 'platform@example.test',
    displayName: 'Platform Admin',
    platformRole: 'super_admin',
  });
}

test('login uses safe errors, records failed attempts, and issues a hashed bearer session', async () => {
  const user = await createUser({ email: 'member@example.test' });
  const rejected = await login('missing@example.test', 'wrong password');
  const rejectedKnown = await login(user.email, 'wrong password');

  assert.equal(rejected.status, 401);
  assert.equal(rejected.body.error.code, 'invalid_credentials');
  assert.deepEqual(rejected.body.error, rejectedKnown.body.error);

  const signedIn = await login(user.email);
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.body.data.user.email, user.email);
  assert.equal(typeof signedIn.body.data.sessionToken, 'string');
  const storedSession = await models.Session.findOne({ userId: user._id }).select('+tokenHash');
  assert.notEqual(storedSession.tokenHash, signedIn.body.data.sessionToken);
  assert.equal(
    await models.AuditLog.countDocuments({ action: 'auth.login', outcome: 'failure' }),
    2,
  );
});

test('cookie sessions require CSRF proof for writes and logout revokes the session', async () => {
  const user = await createUser({ email: 'cookie@example.test' });
  const agent = request.agent(app);
  const signedIn = await agent
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: 'correct horse battery' })
    .expect(200);
  const csrfToken = signedIn.body.data.csrfToken;
  const session = await models.Session.findOne({ userId: user._id });

  assert.equal(
    signedIn.headers['set-cookie'].some((cookie) => cookie.includes('HttpOnly')),
    true,
  );
  await agent.patch('/api/v1/auth/profile').send({ displayName: 'Updated Name' }).expect(403);
  await agent
    .patch('/api/v1/auth/profile')
    .set('x-csrf-token', csrfToken)
    .send({ displayName: 'Updated Name' })
    .expect(200);
  await agent.post('/api/v1/auth/logout').set('x-csrf-token', csrfToken).send({}).expect(200);
  await agent.get('/api/v1/auth/me').expect(401);

  const revoked = await models.Session.findById(session._id);
  assert.ok(revoked.revokedAt);
  assert.equal(await models.AuditLog.countDocuments({ action: 'auth.logout' }), 1);
});

test('expired sessions are rejected', async () => {
  const user = await createUser({ email: 'expired@example.test' });
  const signedIn = await login(user.email);
  const expiredAt = new Date(Date.now() - 1000);
  await models.Session.updateOne({ userId: user._id }, { expiresAt: expiredAt });

  const response = await request(app)
    .get('/api/v1/auth/me')
    .set(bearer(signedIn.body.data.sessionToken))
    .expect(401);
  assert.equal(response.body.error.code, 'session_invalid');
});

test('Super Admin provisions registrations, controls tenant access, and invites a primary admin', async () => {
  const superAdmin = await createPlatformAdmin();
  const platformLogin = await login(superAdmin.email);
  const headers = bearer(platformLogin.body.data.sessionToken);
  const societyAdmin = await createUser({ email: 'society-admin@example.test' });
  const societyAdminLogin = await login(societyAdmin.email);
  const societyAdminHeaders = bearer(societyAdminLogin.body.data.sessionToken);

  await request(app).get('/api/v1/platform/dashboard').set(societyAdminHeaders).expect(403);
  const planResponse = await request(app)
    .post('/api/v1/platform/plans')
    .set(headers)
    .send({
      name: 'Standard',
      code: 'standard',
      description: 'Configured test plan',
      limits: { maxMembers: 8, maxHomes: 12, maxStorageMb: 512 },
      priceMinor: null,
      currency: null,
    })
    .expect(201);
  const submitted = await request(app)
    .post('/api/v1/platform/registrations')
    .send({
      name: 'Cedar Court',
      slug: 'cedar-court',
      registrationNumber: 'CC-100',
      address: '14 Cedar Street',
      contactName: 'Cedar Contact',
      contactEmail: 'admin@example.test',
      contactPhone: '+10000000000',
    })
    .expect(201);
  const societyId = submitted.body.data.registration.id;
  assert.equal(submitted.body.data.registration.status, 'pending_review');

  const pendingList = await request(app)
    .get('/api/v1/platform/societies?status=pending_review&q=cedar-court&page=1&limit=1')
    .set(headers)
    .expect(200);
  assert.equal(pendingList.body.data.pagination.total, 1);
  const unauthorizedExport = await request(app)
    .get('/api/v1/platform/societies/export')
    .set(societyAdminHeaders)
    .expect(403);
  assert.equal(unauthorizedExport.body.error.code, 'permission_denied');

  const rejectedRegistration = await request(app)
    .post('/api/v1/platform/registrations')
    .send({
      name: 'Rejected Society',
      slug: 'rejected-society',
      contactName: 'Rejected Contact',
      contactEmail: 'rejected@example.test',
    })
    .expect(201);
  const rejectedId = rejectedRegistration.body.data.registration.id;
  await request(app)
    .post(`/api/v1/platform/societies/${rejectedId}/reject`)
    .set(headers)
    .send({ reason: 'Registration details could not be verified.' })
    .expect(200);
  assert.equal((await models.Society.findById(rejectedId)).status, 'rejected');

  await request(app)
    .get(`/api/v1/platform/societies/${societyId}`)
    .set(societyAdminHeaders)
    .expect(403);
  const approved = await request(app)
    .post(`/api/v1/platform/societies/${societyId}/approve`)
    .set(headers)
    .send({ planId: planResponse.body.data.plan.id, trialDays: 21 })
    .expect(200);
  assert.equal(approved.body.data.society.status, 'active');
  assert.equal(approved.body.data.society.subscription.status, 'trialing');
  assert.equal(approved.body.data.society.subscription.plan.id, planResponse.body.data.plan.id);
  assert.equal(approved.body.data.society.primaryAdmin.email, 'admin@example.test');
  assert.equal(delivery.invitations.length, 1);
  assert.ok(await models.AuditLog.findOne({ action: 'society.registration.approve', societyId }));

  const accepted = await request(app)
    .post('/api/v1/auth/invitations/accept')
    .send({
      token: delivery.invitations[0].token,
      displayName: 'Society Admin',
      password: 'a very secure password',
    })
    .expect(200);
  assert.equal(accepted.body.data.membershipStatus, 'active');
  await request(app)
    .post('/api/v1/auth/invitations/accept')
    .send({
      token: delivery.invitations[0].token,
      displayName: 'Society Admin',
      password: 'a very secure password',
    })
    .expect(400);

  const adminLogin = await login('admin@example.test', 'a very secure password');
  assert.equal(adminLogin.status, 200);
  assert.equal(adminLogin.body.data.societies[0].id, societyId);

  const adminHeaders = bearer(adminLogin.body.data.sessionToken);
  const alternateAdmin = await createUser({ email: 'alternate-admin@example.test' });
  const alternateMembership = await addMembership(
    alternateAdmin,
    await models.Society.findById(societyId),
  );
  await request(app)
    .patch(
      `/api/v1/platform/societies/${societyId}/memberships/${approved.body.data.society.primaryAdmin.membershipId}/role`,
    )
    .set(headers)
    .send({ role: 'house_owner' })
    .expect(409);
  await request(app)
    .put(`/api/v1/platform/societies/${societyId}/primary-admin`)
    .set(headers)
    .send({ membershipId: String(alternateMembership._id) })
    .expect(200);
  const profile = await request(app)
    .patch(`/api/v1/platform/societies/${societyId}/profile`)
    .set(headers)
    .send({ address: 'Updated address' })
    .expect(200);
  assert.equal(profile.body.data.society.address, 'Updated address');
  await request(app)
    .post(`/api/v1/auth/societies/${societyId}/select`)
    .set(adminHeaders)
    .send({})
    .expect(200);
  await request(app)
    .get(`/api/v1/societies/${societyId}/memberships`)
    .set(adminHeaders)
    .expect(200);

  await request(app)
    .patch(`/api/v1/platform/societies/${societyId}/status`)
    .set(headers)
    .send({ status: 'suspended' })
    .expect(200);
  await request(app)
    .get(`/api/v1/societies/${societyId}/memberships`)
    .set(adminHeaders)
    .expect(403);
  await request(app)
    .patch(`/api/v1/platform/societies/${societyId}/status`)
    .set(headers)
    .send({ status: 'active' })
    .expect(200);
  const exportResponse = await request(app)
    .get('/api/v1/platform/societies/export?status=active&q=cedar')
    .set(headers)
    .expect(200);
  assert.match(exportResponse.headers['content-type'], /text\/csv/);
  assert.match(exportResponse.text, /Cedar Court/);
  assert.ok(
    await models.AuditLog.findOne({ action: 'platform.societies.export', outcome: 'success' }),
  );
  await request(app)
    .get(`/api/v1/societies/${societyId}/memberships`)
    .set(adminHeaders)
    .expect(200);
  await request(app)
    .patch(`/api/v1/platform/societies/${societyId}/status`)
    .set(headers)
    .send({ status: 'archived' })
    .expect(200);
  await request(app)
    .patch(`/api/v1/platform/societies/${societyId}/status`)
    .set(headers)
    .send({ status: 'active' })
    .expect(409);
});

test('platform-only subscription, audit, and support APIs reject Society Admin access', async () => {
  const superAdmin = await createPlatformAdmin();
  const tenantAdmin = await createUser({ email: 'ticket-admin@example.test' });
  const society = await createSociety('support-society');
  const otherSociety = await createSociety('support-other-society');
  await addMembership(tenantAdmin, society);
  const platformLogin = await login(superAdmin.email);
  const tenantLogin = await login(tenantAdmin.email);
  const platformHeaders = bearer(platformLogin.body.data.sessionToken);
  const tenantHeaders = bearer(tenantLogin.body.data.sessionToken);

  await request(app)
    .post(`/api/v1/auth/societies/${society._id}/select`)
    .set(tenantHeaders)
    .send({})
    .expect(200);
  await request(app)
    .post(`/api/v1/societies/${society._id}/support-tickets`)
    .set(tenantHeaders)
    .send({
      subject: 'Access help needed',
      description: 'Please help reset the building access settings.',
    })
    .expect(201);
  await request(app)
    .get(`/api/v1/societies/${otherSociety._id}/support-tickets`)
    .set(tenantHeaders)
    .expect(404);

  await request(app).get('/api/v1/platform/audit-logs').set(tenantHeaders).expect(403);
  await request(app).get('/api/v1/platform/support-tickets').set(tenantHeaders).expect(403);
  const tickets = await request(app)
    .get('/api/v1/platform/support-tickets')
    .set(platformHeaders)
    .expect(200);
  assert.equal(tickets.body.data.tickets.length, 1);
  const ticketId = tickets.body.data.tickets[0].id;
  await request(app)
    .patch(`/api/v1/platform/support-tickets/${ticketId}`)
    .set(tenantHeaders)
    .send({ status: 'resolved' })
    .expect(403);
  await request(app)
    .patch(`/api/v1/platform/support-tickets/${ticketId}`)
    .set(platformHeaders)
    .send({
      status: 'in_progress',
      priority: 'urgent',
      assignedTo: String(superAdmin._id),
    })
    .expect(200);
  assert.equal(
    (await models.SupportTicket.findById(ticketId)).assignedTo.toString(),
    String(superAdmin._id),
  );
  const audit = await request(app)
    .get('/api/v1/platform/audit-logs?action=support_ticket.create')
    .set(platformHeaders)
    .expect(200);
  assert.equal(audit.body.data.auditLogs.length, 1);
  const auditExport = await request(app)
    .get('/api/v1/platform/audit-logs/export?action=support_ticket.create')
    .set(platformHeaders)
    .expect(200);
  assert.match(auditExport.headers['content-type'], /text\/csv/);
  const ticketExport = await request(app)
    .get('/api/v1/platform/support-tickets/export')
    .set(platformHeaders)
    .expect(200);
  assert.match(ticketExport.text, /Access help needed/);
});

test('society configuration is tenant-scoped, admin-managed, audited, and preserves charge-rule history', async () => {
  const admin = await createUser({ email: 'settings-admin@example.test' });
  const owner = await createUser({ email: 'settings-owner@example.test' });
  const society = await createSociety('settings-society');
  const otherSociety = await createSociety('settings-other-society');
  await addMembership(admin, society);
  await addMembership(owner, society, 'house_owner');
  await addMembership(admin, otherSociety);

  const adminLogin = await login(admin.email);
  const ownerLogin = await login(owner.email);
  const adminHeaders = bearer(adminLogin.body.data.sessionToken);
  const ownerHeaders = bearer(ownerLogin.body.data.sessionToken);
  await request(app)
    .post(`/api/v1/auth/societies/${society._id}/select`)
    .set(adminHeaders)
    .send({})
    .expect(200);

  const initial = await request(app)
    .get(`/api/v1/societies/${society._id}/settings`)
    .set(adminHeaders)
    .expect(200);
  assert.equal(initial.body.data.settings.currency, 'INR');
  assert.deepEqual(initial.body.data.approvalPolicies, []);

  const ownerSettings = await request(app)
    .get(`/api/v1/societies/${society._id}/settings`)
    .set(ownerHeaders)
    .expect(200);
  assert.equal(ownerSettings.body.data.society.name, society.name);
  assert.equal('approvalPolicies' in ownerSettings.body.data, false);
  await request(app)
    .patch(`/api/v1/societies/${society._id}/settings`)
    .set(ownerHeaders)
    .send({ profile: { name: 'Owner changed this' } })
    .expect(403);
  await request(app)
    .get(`/api/v1/societies/${otherSociety._id}/settings`)
    .set(adminHeaders)
    .expect(404);

  await request(app)
    .patch(`/api/v1/societies/${society._id}/settings`)
    .set(adminHeaders)
    .send({
      profile: {
        name: 'Configured Society',
        address: '10 Main Street',
        contactName: 'Office',
        contactEmail: 'office@example.test',
        contactPhone: '+911234567890',
        registrationNumber: 'REG-42',
        logoUrl: 'https://cdn.example.test/logo.png',
      },
    })
    .expect(200);
  const effectiveToday = new Date();
  effectiveToday.setUTCHours(0, 0, 0, 0);
  const firstRules = {
    effectiveFrom: effectiveToday.toISOString(),
    frequency: 'monthly',
    areaUnit: null,
    charges: [
      {
        code: 'maintenance',
        name: 'Monthly maintenance',
        calculation: 'fixed_per_home',
        amountMinor: 125000,
      },
    ],
    dueDayOfPeriod: 10,
    lateFee: { type: 'fixed', amountMinor: 5000 },
    gracePeriodDays: 7,
  };
  await request(app)
    .patch(`/api/v1/societies/${society._id}/settings`)
    .set(adminHeaders)
    .send({
      chargeRules: {
        ...firstRules,
        charges: [
          {
            code: 'area_maintenance',
            name: 'Area maintenance',
            calculation: 'per_area',
            amountMinor: 100,
          },
        ],
      },
    })
    .expect(422);
  await request(app)
    .patch(`/api/v1/societies/${society._id}/settings`)
    .set(adminHeaders)
    .send({ chargeRules: firstRules })
    .expect(200);
  const storedV1 = await models.ChargeRules.findOne({
    societyId: society._id,
    version: 1,
  }).lean();
  assert.ok(storedV1);

  const future = new Date(effectiveToday.getTime() + 86400000).toISOString();
  await request(app)
    .patch(`/api/v1/societies/${society._id}/settings`)
    .set(adminHeaders)
    .send({
      chargeRules: {
        ...firstRules,
        effectiveFrom: future,
        charges: [{ ...firstRules.charges[0], amountMinor: 145000 }],
      },
    })
    .expect(200);
  const [storedV1After, storedV2] = await Promise.all([
    models.ChargeRules.findById(storedV1._id).lean(),
    models.ChargeRules.findOne({ societyId: society._id, version: 2 }).lean(),
  ]);
  assert.equal(storedV1After.charges[0].amountMinor, 125000);
  assert.equal(storedV2.charges[0].amountMinor, 145000);
  const activeRules = await request(app)
    .get(`/api/v1/societies/${society._id}/settings`)
    .set(ownerHeaders)
    .expect(200);
  assert.equal(activeRules.body.data.chargeRules.version, 1);

  await request(app)
    .patch(`/api/v1/societies/${society._id}/settings`)
    .set(adminHeaders)
    .send({
      settings: {
        timeZone: 'Not/A_Timezone',
        currency: 'US',
        dateFormat: 'DD/MM/YYYY',
        financialYearStartMonth: 2,
        financialYearStartDay: 30,
        numbering: { building: 'B-{number}', wing: 'W-{letter}', flat: 'F-{number}' },
        visitorRules: { requirePreApproval: false, maxVisitDaysAhead: 30 },
        complaintRules: { acknowledgmentHours: 24, resolutionTargetHours: 168 },
        notificationRules: { emailEnabled: true, pushEnabled: true, smsEnabled: false },
        facilityBookingRules: {
          maxDaysAhead: 30,
          requireApproval: true,
          maxBookingsPerDay: 1,
        },
        branding: { primaryColor: '#142b4a', accentColor: '#2563eb' },
      },
    })
    .expect(422);
  await request(app)
    .patch(`/api/v1/societies/${society._id}/settings`)
    .set(adminHeaders)
    .send({
      settings: {
        timeZone: 'Asia/Kolkata',
        currency: 'INR',
        dateFormat: 'DD/MM/YYYY',
        financialYearStartMonth: 4,
        financialYearStartDay: 1,
        numbering: { building: 'B-{number}', wing: 'W-{letter}', flat: 'F-{number}' },
        visitorRules: { requirePreApproval: true, maxVisitDaysAhead: 14 },
        complaintRules: { acknowledgmentHours: 12, resolutionTargetHours: 120 },
        notificationRules: { emailEnabled: true, pushEnabled: false, smsEnabled: false },
        facilityBookingRules: {
          maxDaysAhead: 45,
          requireApproval: true,
          maxBookingsPerDay: 2,
        },
        branding: { primaryColor: '#112233', accentColor: '#445566' },
      },
    })
    .expect(200);
  await request(app)
    .patch(`/api/v1/societies/${society._id}/settings`)
    .set(adminHeaders)
    .send({
      approvalPolicies: {
        policies: [
          {
            operation: 'expense',
            enabled: true,
            requiredApprovals: 2,
            amountThresholdMinor: 500000,
          },
          {
            operation: 'expense',
            enabled: true,
            requiredApprovals: 1,
            amountThresholdMinor: null,
          },
        ],
      },
    })
    .expect(422);
  await request(app)
    .patch(`/api/v1/societies/${society._id}/settings`)
    .set(adminHeaders)
    .send({
      notificationTemplates: {
        templates: [
          {
            key: 'notice_published',
            channel: 'email',
            subject: 'A new notice',
            body: 'A society notice was published.',
            enabled: true,
          },
        ],
      },
    })
    .expect(200);
  const audit = await models.AuditLog.find({
    societyId: society._id,
    action: 'society.settings.update',
  }).lean();
  assert.equal(audit.length, 5);
  assert.equal(
    audit.some((entry) => JSON.stringify(entry.metadata).includes('office@example.test')),
    false,
  );
});

test('plan limits are enforced when inviting additional tenant members', async () => {
  const superAdmin = await createPlatformAdmin();
  const admin = await createUser({ email: 'limited-admin@example.test' });
  const society = await createSociety('limited-society');
  await addMembership(admin, society);
  const platformLogin = await login(superAdmin.email);
  const adminLogin = await login(admin.email);
  const platformHeaders = bearer(platformLogin.body.data.sessionToken);
  const adminHeaders = bearer(adminLogin.body.data.sessionToken);
  const plan = await models.SubscriptionPlan.create({
    name: 'One member',
    code: 'one-member',
    limits: { maxMembers: 1 },
  });
  await models.Subscription.create({
    societyId: society._id,
    planId: plan._id,
    status: 'active',
    limits: plan.limits,
    configuredBy: superAdmin._id,
  });
  await request(app)
    .post(`/api/v1/auth/societies/${society._id}/select`)
    .set(adminHeaders)
    .send({})
    .expect(200);
  await request(app)
    .post(`/api/v1/societies/${society._id}/invitations`)
    .set(adminHeaders)
    .send({ email: 'over-limit@example.test' })
    .expect(409);
  await request(app)
    .patch(`/api/v1/platform/plans/${plan._id}`)
    .set(platformHeaders)
    .send({ limits: { maxMembers: 2 } })
    .expect(200);
  assert.equal(
    (await models.Subscription.findOne({ societyId: society._id })).limits.maxMembers,
    2,
  );
  await request(app)
    .post(`/api/v1/societies/${society._id}/invitations`)
    .set(adminHeaders)
    .send({ email: 'within-limit@example.test' })
    .expect(201);
  const dashboard = await request(app)
    .get('/api/v1/platform/dashboard')
    .set(platformHeaders)
    .expect(200);
  assert.equal(dashboard.body.data.societies.active, 1);
  assert.equal(dashboard.body.data.subscriptions.active, 1);
});

test('concurrent invitation acceptance requests can only consume the token once', async () => {
  const user = await createUser({ email: 'invited-admin@example.test' });
  const inviter = await createPlatformAdmin();
  const society = await createSociety('concurrent-invitation');
  const token = createRawToken();
  await models.SocietyMembership.create({
    userId: user._id,
    societyId: society._id,
    role: 'society_admin',
    status: 'invited',
    invitedBy: inviter._id,
    invitationTokenHash: hashToken(token),
    invitationExpiresAt: new Date(Date.now() + 60_000),
  });
  const signedIn = await login(user.email);
  const headers = bearer(signedIn.body.data.sessionToken);
  const accept = () =>
    request(app).post('/api/v1/auth/invitations/accept').set(headers).send({ token });

  const responses = await Promise.all([accept(), accept()]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
  assert.equal(await models.SocietyMembership.countDocuments({ status: 'active' }), 1);
});

test('a session cannot select or access a society without an active membership', async () => {
  const user = await createUser({ email: 'outsider@example.test' });
  const society = await createSociety('private-society');
  const signedIn = await login(user.email);
  const headers = bearer(signedIn.body.data.sessionToken);

  await request(app)
    .post(`/api/v1/auth/societies/${society._id}/select`)
    .set(headers)
    .send({})
    .expect(404);
  await request(app).get(`/api/v1/societies/${society._id}/memberships`).set(headers).expect(404);
});

test('society context rejects URL, query, header, and body tenant substitution', async () => {
  const admin = await createUser({ email: 'tenant-admin@example.test' });
  const societyA = await createSociety('tenant-a');
  const societyB = await createSociety('tenant-b');
  await addMembership(admin, societyA);
  await addMembership(admin, societyB);
  const signedIn = await login(admin.email);
  const headers = bearer(signedIn.body.data.sessionToken);
  await request(app)
    .post(`/api/v1/auth/societies/${societyA._id}/select`)
    .set(headers)
    .send({})
    .expect(200);

  await request(app).get(`/api/v1/societies/${societyB._id}/memberships`).set(headers).expect(404);
  await request(app)
    .get(`/api/v1/societies/${societyA._id}/memberships?societyId=${societyB._id}`)
    .set(headers)
    .expect(422);
  await request(app)
    .get(`/api/v1/societies/${societyA._id}/memberships`)
    .set({ ...headers, 'x-society-id': String(societyB._id) })
    .expect(404);
  await request(app)
    .post(`/api/v1/societies/${societyA._id}/invitations`)
    .set(headers)
    .send({ email: 'owner@example.test', societyId: String(societyB._id) })
    .expect(422);

  const audits = await models.AuditLog.countDocuments({
    action: 'auth.society.access.denied',
  });
  assert.ok(audits > 0);
});

test('role permissions deny owners and isolate membership updates by society', async () => {
  const admin = await createUser({ email: 'admin-a@example.test' });
  const owner = await createUser({ email: 'owner-a@example.test' });
  const societyA = await createSociety('scope-a');
  const societyB = await createSociety('scope-b');
  const ownerMembershipB = await addMembership(owner, societyB, 'house_owner');
  await addMembership(admin, societyA);
  await addMembership(owner, societyA, 'house_owner');

  const adminLogin = await login(admin.email);
  const adminHeaders = bearer(adminLogin.body.data.sessionToken);
  await request(app)
    .post(`/api/v1/auth/societies/${societyA._id}/select`)
    .set(adminHeaders)
    .send({})
    .expect(200);
  await request(app)
    .patch(`/api/v1/societies/${societyA._id}/memberships/${ownerMembershipB._id}/status`)
    .set(adminHeaders)
    .send({ status: 'revoked' })
    .expect(404);

  const ownerLogin = await login(owner.email);
  const ownerHeaders = bearer(ownerLogin.body.data.sessionToken);
  await request(app)
    .post(`/api/v1/auth/societies/${societyA._id}/select`)
    .set(ownerHeaders)
    .send({})
    .expect(200);
  await request(app)
    .get(`/api/v1/societies/${societyA._id}/memberships`)
    .set(ownerHeaders)
    .expect(403);

  assert.equal(await models.AuditLog.countDocuments({ action: 'auth.permission.denied' }), 1);
});

test('only platform administrators can change a membership role, and changes are audited', async () => {
  const superAdmin = await createPlatformAdmin();
  const owner = await createUser({ email: 'promoted-owner@example.test' });
  const society = await createSociety('role-change');
  const membership = await addMembership(owner, society, 'house_owner');
  const superAdminLogin = await login(superAdmin.email);
  const ownerLogin = await login(owner.email);
  const platformHeaders = bearer(superAdminLogin.body.data.sessionToken);
  const ownerHeaders = bearer(ownerLogin.body.data.sessionToken);

  await request(app)
    .patch(`/api/v1/platform/societies/${society._id}/memberships/${membership._id}/role`)
    .set(ownerHeaders)
    .send({ role: 'society_admin' })
    .expect(403);
  await request(app)
    .patch(`/api/v1/platform/societies/${society._id}/memberships/${membership._id}/role`)
    .set(platformHeaders)
    .send({ role: 'society_admin' })
    .expect(200);

  const updatedMembership = await models.SocietyMembership.findById(membership._id);
  assert.equal(updatedMembership.role, 'society_admin');
  assert.equal(
    await models.AuditLog.countDocuments({ action: 'membership.role.change', outcome: 'success' }),
    1,
  );
  assert.equal(
    await models.AuditLog.countDocuments({ action: 'auth.permission.denied', outcome: 'failure' }),
    1,
  );
});

test('revoking an active membership blocks the next society request', async () => {
  const admin = await createUser({ email: 'manager@example.test' });
  const owner = await createUser({ email: 'member-to-revoke@example.test' });
  const society = await createSociety('revoke-society');
  const ownerMembership = await addMembership(owner, society, 'house_owner');
  await addMembership(admin, society);
  const adminLogin = await login(admin.email);
  const ownerLogin = await login(owner.email);
  const adminHeaders = bearer(adminLogin.body.data.sessionToken);
  const ownerHeaders = bearer(ownerLogin.body.data.sessionToken);

  await request(app)
    .post(`/api/v1/auth/societies/${society._id}/select`)
    .set(ownerHeaders)
    .send({})
    .expect(200);
  await request(app)
    .post(`/api/v1/auth/societies/${society._id}/select`)
    .set(adminHeaders)
    .send({})
    .expect(200);
  await request(app)
    .patch(`/api/v1/societies/${society._id}/memberships/${ownerMembership._id}/status`)
    .set(adminHeaders)
    .send({ status: 'revoked' })
    .expect(200);

  await request(app)
    .get(`/api/v1/societies/${society._id}/memberships`)
    .set(ownerHeaders)
    .expect(403);
  const currentUser = await request(app).get('/api/v1/auth/me').set(ownerHeaders).expect(200);
  assert.equal(currentUser.body.data.societies.length, 0);
  assert.equal(await models.AuditLog.countDocuments({ action: 'membership.status.change' }), 1);
});

test('authentication endpoints rate-limit repeated attempts and audit throttling', async () => {
  const limitedApp = createApp({
    config: { ...config, authRateLimitMax: 1 },
    logger,
    models,
    mailer,
  });
  await request(limitedApp)
    .post('/api/v1/auth/login')
    .send({ email: 'limited@example.test', password: 'wrong password' })
    .expect(401);
  const throttled = await request(limitedApp)
    .post('/api/v1/auth/login')
    .send({ email: 'limited@example.test', password: 'wrong password' })
    .expect(429);

  assert.equal(throttled.body.error.code, 'rate_limit_exceeded');
  assert.equal(await models.AuditLog.countDocuments({ action: 'auth.rate_limit' }), 1);
});

test('password reset is generic for unknown users, one-use, and revokes existing sessions', async () => {
  const user = await createUser({ email: 'reset@example.test' });
  const signedIn = await login(user.email);
  await request(app)
    .post('/api/v1/auth/password/forgot')
    .send({ email: 'unknown@example.test' })
    .expect(202);
  await request(app).post('/api/v1/auth/password/forgot').send({ email: user.email }).expect(202);
  assert.equal(delivery.resets.length, 1);
  const resetRecord = await models.User.findById(user._id).select('+passwordResetTokenHash');
  assert.notEqual(resetRecord.passwordResetTokenHash, delivery.resets[0].token);

  await request(app)
    .post('/api/v1/auth/password/reset')
    .send({ token: delivery.resets[0].token, password: 'new secure password' })
    .expect(200);
  await request(app)
    .get('/api/v1/auth/me')
    .set(bearer(signedIn.body.data.sessionToken))
    .expect(401);
  await request(app)
    .post('/api/v1/auth/password/reset')
    .send({ token: delivery.resets[0].token, password: 'another secure password' })
    .expect(400);
  assert.equal((await login(user.email, 'new secure password')).status, 200);
});

test('email verification is required when configured and pending admin membership activates on verification', async () => {
  const localConfig = { ...config, emailVerificationRequired: true };
  const localApp = createApp({ config: localConfig, logger, models, mailer });
  const superAdmin = await createPlatformAdmin();
  const platformLogin = await request(localApp)
    .post('/api/v1/auth/login')
    .set('x-session-transport', 'bearer')
    .send({ email: superAdmin.email, password: 'correct horse battery' })
    .expect(200);
  const headers = bearer(platformLogin.body.data.sessionToken);
  const plan = await request(localApp)
    .post('/api/v1/platform/plans')
    .set(headers)
    .send({ name: 'Verification Plan', code: 'verification-plan' })
    .expect(201);
  const registration = await request(localApp)
    .post('/api/v1/platform/registrations')
    .send({
      name: 'Verification Society',
      slug: 'verification-society',
      contactName: 'Unverified Admin',
      contactEmail: 'unverified-admin@example.test',
    })
    .expect(201);
  await request(localApp)
    .post(`/api/v1/platform/societies/${registration.body.data.registration.id}/approve`)
    .set(headers)
    .send({ planId: plan.body.data.plan.id, trialDays: 0 })
    .expect(200);
  const accepted = await request(localApp)
    .post('/api/v1/auth/invitations/accept')
    .send({
      token: delivery.invitations[0].token,
      displayName: 'Unverified Admin',
      password: 'secure invited password',
    })
    .expect(200);
  assert.equal(accepted.body.data.membershipStatus, 'pending_verification');
  await request(localApp)
    .post('/api/v1/auth/login')
    .set('x-session-transport', 'bearer')
    .send({ email: 'unverified-admin@example.test', password: 'secure invited password' })
    .expect(403);

  await request(localApp)
    .post('/api/v1/auth/email/verify')
    .send({ token: delivery.verifications[0].token })
    .expect(200);
  assert.equal(
    await models.SocietyMembership.countDocuments({
      userId: accepted.body.data.user.id,
      status: 'active',
    }),
    1,
  );
});

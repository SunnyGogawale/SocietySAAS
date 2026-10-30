const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const mongoose = require('mongoose');
const pino = require('pino');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createApp } = require('../src/app');
const models = require('../src/models');
const { hashPassword } = require('../src/utils/password');
const { createRawToken, hashToken } = require('../src/utils/securityToken');
const { multiplyRateByArea, roundHalfUp } = require('../src/services/billing.service');

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
  paymentCredentialEncryptionKey: Buffer.from('test-only-payment-key-32-bytes!!').toString(
    'base64',
  ),
};
let providerLinkSequence = 0;
const providerPayments = new Map();
async function paymentFetch(url, options = {}) {
  const pathname = new URL(url).pathname;
  if (pathname === '/v1/payment_links' && options.method === 'POST') {
    providerLinkSequence += 1;
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          id: `plink_test_${providerLinkSequence}`,
          short_url: `https://rzp.io/i/test-${providerLinkSequence}`,
        };
      },
    };
  }
  const paymentMatch = pathname.match(/^\/v1\/payments\/([^/]+)$/);
  if (paymentMatch && options.method !== 'POST') {
    const payment = providerPayments.get(paymentMatch[1]);
    return {
      ok: Boolean(payment),
      status: payment ? 200 : 404,
      async json() {
        return payment ?? {};
      },
    };
  }
  if (/^\/v1\/payments\/[^/]+\/refund$/.test(pathname) && options.method === 'POST') {
    return {
      ok: true,
      status: 200,
      async json() {
        return { id: `rfnd_test_${providerPayments.size}_${Date.now()}`, status: 'pending' };
      },
    };
  }
  return {
    ok: false,
    status: 404,
    async json() {
      return {};
    },
  };
}
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
  app = createApp({ config: { ...config, mongoUri: uri }, logger, models, mailer, paymentFetch });
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
    lateFee: { type: 'percentage', rateBasisPoints: 100, capAmountMinor: 5000 },
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

test('property management enforces tenant scope, prevents duplicate flats and parking conflicts, and revokes ended-owner access', async () => {
  const admin = await createUser({ email: 'property-admin@example.test' });
  const owner = await createUser({ email: 'property-owner@example.test' });
  const otherOwner = await createUser({ email: 'other-property-owner@example.test' });
  const society = await createSociety('property-society');
  const otherSociety = await createSociety('other-property-society');
  await addMembership(admin, society);
  const ownerMembership = await addMembership(owner, society, 'house_owner');
  const otherMembership = await addMembership(otherOwner, society, 'house_owner');
  await addMembership(admin, otherSociety);

  const adminLogin = await login(admin.email);
  const adminHeaders = bearer(adminLogin.body.data.sessionToken);
  await request(app)
    .post(`/api/v1/auth/societies/${society._id}/select`)
    .set(adminHeaders)
    .send({})
    .expect(200);
  const ownerLogin = await login(owner.email);
  const ownerHeaders = bearer(ownerLogin.body.data.sessionToken);
  await request(app)
    .post(`/api/v1/auth/societies/${society._id}/select`)
    .set(ownerHeaders)
    .send({})
    .expect(200);

  const building = await request(app)
    .post(`/api/v1/societies/${society._id}/buildings`)
    .set(adminHeaders)
    .send({ name: 'North Tower', code: 'N' })
    .expect(201);
  const buildingId = building.body.data.building._id;
  const wing = await request(app)
    .post(`/api/v1/societies/${society._id}/wings`)
    .set(adminHeaders)
    .send({ buildingId, name: 'East Wing', code: 'E' })
    .expect(201);
  const floor = await request(app)
    .post(`/api/v1/societies/${society._id}/floors`)
    .set(adminHeaders)
    .send({ buildingId, wingId: wing.body.data.wing._id, floorNumber: 1, label: 'First floor' })
    .expect(201);

  const createFlat = (flatNumber) =>
    request(app).post(`/api/v1/societies/${society._id}/flats`).set(adminHeaders).send({
      buildingId,
      wingId: wing.body.data.wing._id,
      floorId: floor.body.data.floor._id,
      flatNumber,
      area: 900,
      areaUnit: 'square_foot',
      propertyType: 'apartment',
    });
  const flatResponse = await createFlat('1A').expect(201);
  const flatId = flatResponse.body.data.flat._id;
  await createFlat('1A').expect(409);

  const secondFlat = await createFlat('1B').expect(201);
  await request(app)
    .get(`/api/v1/societies/${otherSociety._id}/properties`)
    .set(adminHeaders)
    .expect(404);
  await request(app)
    .post(`/api/v1/societies/${society._id}/flats/${secondFlat.body.data.flat._id}/owners/link`)
    .set(adminHeaders)
    .send({ membershipId: String(otherMembership._id), ownershipType: 'owner' })
    .expect(201);

  const ownerLink = await request(app)
    .post(`/api/v1/societies/${society._id}/flats/${flatId}/owners/invite`)
    .set(adminHeaders)
    .send({ email: owner.email, ownershipType: 'owner' })
    .expect(201);
  assert.equal(ownerLink.body.data.ownership.status, 'active');
  const residents = await request(app)
    .get(`/api/v1/societies/${society._id}/residents?status=active&residentType=owner`)
    .set(adminHeaders)
    .expect(200);
  assert.equal(residents.body.data.residents.length, 2);
  assert.equal(residents.body.data.pagination.total, 2);
  const ownerSearch = await request(app)
    .get(`/api/v1/societies/${society._id}/residents?q=other-`)
    .set(adminHeaders)
    .expect(200);
  assert.equal(ownerSearch.body.data.residents.length, 1);
  assert.equal(ownerSearch.body.data.residents[0].email, otherOwner.email);
  const invitedOwner = await request(app)
    .post(`/api/v1/societies/${society._id}/flats/${flatId}/owners/invite`)
    .set(adminHeaders)
    .send({ email: 'invited-property-owner@example.test', ownershipType: 'co_owner' })
    .expect(201);
  assert.equal(invitedOwner.body.data.ownership.status, 'invited');
  const acceptedOwner = await request(app)
    .post('/api/v1/auth/invitations/accept')
    .send({
      token: delivery.invitations.at(-1).token,
      displayName: 'Invited Property Owner',
      password: 'a very secure password',
    })
    .expect(200);
  assert.equal(acceptedOwner.body.data.membershipStatus, 'pending_verification');
  await request(app)
    .patch(
      `/api/v1/societies/${society._id}/memberships/${invitedOwner.body.data.invitation.id}/status`,
    )
    .set(adminHeaders)
    .send({ status: 'active' })
    .expect(200);
  assert.equal(
    await models.Ownership.countDocuments({
      _id: invitedOwner.body.data.ownership.id,
      status: 'active',
    }),
    1,
  );
  const ownerProperties = await request(app)
    .get(`/api/v1/societies/${society._id}/properties`)
    .set(ownerHeaders)
    .expect(200);
  assert.deepEqual(
    ownerProperties.body.data.properties.map(({ id }) => id),
    [flatId],
  );
  const ownerStructure = await request(app)
    .get(`/api/v1/societies/${society._id}/properties/structure`)
    .set(ownerHeaders)
    .expect(200);
  assert.equal(ownerStructure.body.data.buildings.length, 1);
  await request(app)
    .get(`/api/v1/societies/${society._id}/residents`)
    .set(ownerHeaders)
    .expect(403);

  const vehicleResponse = await request(app)
    .post(`/api/v1/societies/${society._id}/flats/${flatId}/vehicles`)
    .set(adminHeaders)
    .send({
      membershipId: String(ownerMembership._id),
      registrationNumber: 'MH01AB1234',
      vehicleType: 'car',
    })
    .expect(201);
  const slot = await request(app)
    .post(`/api/v1/societies/${society._id}/parking-slots`)
    .set(adminHeaders)
    .send({ buildingId, flatId: null, slotNumber: 'P-1' })
    .expect(201);
  await request(app)
    .post(`/api/v1/societies/${society._id}/parking-slots/${slot.body.data.parkingSlot._id}/assign`)
    .set(adminHeaders)
    .send({ flatId, vehicleId: vehicleResponse.body.data.vehicle._id })
    .expect(201);
  const secondSlot = await request(app)
    .post(`/api/v1/societies/${society._id}/parking-slots`)
    .set(adminHeaders)
    .send({ buildingId, slotNumber: 'P-2' })
    .expect(201);
  await request(app)
    .post(
      `/api/v1/societies/${society._id}/parking-slots/${secondSlot.body.data.parkingSlot._id}/assign`,
    )
    .set(adminHeaders)
    .send({ flatId, vehicleId: vehicleResponse.body.data.vehicle._id })
    .expect(409);

  const occupancy = await request(app)
    .post(`/api/v1/societies/${society._id}/flats/${secondFlat.body.data.flat._id}/occupancies`)
    .set(adminHeaders)
    .send({
      residentType: 'tenant',
      name: 'Tenant Resident',
      startsAt: new Date(Date.now() - 60_000).toISOString(),
    })
    .expect(201);
  const tenantVehicle = await request(app)
    .post(`/api/v1/societies/${society._id}/flats/${secondFlat.body.data.flat._id}/vehicles`)
    .set(adminHeaders)
    .send({
      occupancyId: String(occupancy.body.data.occupancy._id),
      registrationNumber: 'MH01XY9876',
      vehicleType: 'motorcycle',
    })
    .expect(201);
  const tenantSlot = await request(app)
    .post(`/api/v1/societies/${society._id}/parking-slots`)
    .set(adminHeaders)
    .send({ buildingId, slotNumber: 'P-3' })
    .expect(201);
  const tenantAssignment = await request(app)
    .post(
      `/api/v1/societies/${society._id}/parking-slots/${tenantSlot.body.data.parkingSlot._id}/assign`,
    )
    .set(adminHeaders)
    .send({
      flatId: secondFlat.body.data.flat._id,
      vehicleId: tenantVehicle.body.data.vehicle._id,
    })
    .expect(201);
  await request(app)
    .patch(`/api/v1/societies/${society._id}/occupancies/${occupancy.body.data.occupancy._id}/end`)
    .set(adminHeaders)
    .send({})
    .expect(200);
  assert.equal(
    (await models.Occupancy.findById(occupancy.body.data.occupancy._id)).status,
    'ended',
  );
  assert.equal(
    (await models.Vehicle.findById(tenantVehicle.body.data.vehicle._id)).status,
    'inactive',
  );
  assert.equal(
    (await models.ParkingAssignment.findById(tenantAssignment.body.data.assignment._id)).status,
    'ended',
  );

  const myProperty = await request(app)
    .get(`/api/v1/societies/${society._id}/my-property`)
    .set(ownerHeaders)
    .expect(200);
  assert.equal(myProperty.body.data.properties.length, 1);
  assert.equal(myProperty.body.data.properties[0].flat.flatNumber, '1A');

  const ownershipId = ownerLink.body.data.ownership.id;
  await request(app)
    .patch(`/api/v1/societies/${society._id}/ownerships/${ownershipId}/end`)
    .set(adminHeaders)
    .send({})
    .expect(200);
  assert.equal(
    await models.Ownership.countDocuments({
      _id: ownershipId,
      societyId: society._id,
      status: 'ended',
    }),
    1,
  );
  assert.equal((await models.SocietyMembership.findById(ownerMembership._id)).status, 'revoked');
  assert.equal(
    (await models.Vehicle.findById(vehicleResponse.body.data.vehicle._id)).status,
    'inactive',
  );
  assert.equal(
    await models.ParkingAssignment.countDocuments({
      societyId: society._id,
      vehicleId: vehicleResponse.body.data.vehicle._id,
      status: 'ended',
    }),
    1,
  );
  await request(app)
    .get(`/api/v1/societies/${society._id}/my-property`)
    .set(ownerHeaders)
    .expect(403);
});

test('property imports retain row errors in tenant-scoped downloadable reports', async () => {
  const admin = await createUser({ email: 'property-import-admin@example.test' });
  const society = await createSociety('property-import-society');
  await addMembership(admin, society);
  const signedIn = await login(admin.email);
  const headers = bearer(signedIn.body.data.sessionToken);
  await request(app)
    .post(`/api/v1/auth/societies/${society._id}/select`)
    .set(headers)
    .send({})
    .expect(200);

  const importedResponse = await request(app)
    .post(`/api/v1/societies/${society._id}/property-imports`)
    .set(headers)
    .send({
      type: 'properties',
      records: [
        {
          buildingCode: 'A',
          buildingName: 'Alpha',
          floorNumber: 1,
          flatNumber: '101',
          area: '800',
          areaUnit: 'square_metre',
          propertyType: 'apartment',
        },
        { buildingCode: '', floorNumber: 'invalid' },
      ],
    });
  assert.equal(importedResponse.status, 201, JSON.stringify(importedResponse.body));
  const imported = importedResponse;
  assert.equal(imported.body.data.createdCount, 1);
  assert.equal(imported.body.data.errorCount, 1);
  const report = await request(app).get(imported.body.data.errorReportUrl).set(headers).expect(200);
  assert.match(report.headers['content-type'], /text\/csv/);
  assert.match(report.text, /buildingCode/);
  assert.equal(
    await models.AuditLog.countDocuments({
      action: 'property.import.errors.export',
      societyId: society._id,
    }),
    1,
  );
  const otherSociety = await createSociety('different-property-import-society');
  await request(app)
    .get(`/api/v1/societies/${otherSociety._id}/property-imports/${imported.body.data.id}/errors`)
    .set(headers)
    .expect(404);
});

test('maintenance billing prorates immutably, allocates FIFO, scopes owners, assesses capped fees, and renders authorized PDFs', async () => {
  const admin = await createUser({ email: 'billing-admin@example.test' });
  const owner = await createUser({ email: 'billing-owner@example.test' });
  const otherOwner = await createUser({ email: 'billing-other-owner@example.test' });
  const society = await createSociety('billing-society');
  const otherSociety = await createSociety('unrelated-billing-society');
  await addMembership(admin, society);
  const ownerMembership = await addMembership(owner, society, 'house_owner');
  const otherOwnerMembership = await addMembership(otherOwner, society, 'house_owner');
  await addMembership(admin, otherSociety);
  await models.SocietySettings.create({ societyId: society._id, areaUnit: 'square_metre' });

  const adminLogin = await login(admin.email);
  const adminHeaders = bearer(adminLogin.body.data.sessionToken);
  await request(app)
    .post(`/api/v1/auth/societies/${society._id}/select`)
    .set(adminHeaders)
    .send({})
    .expect(200);
  const ownerLogin = await login(owner.email);
  const ownerHeaders = bearer(ownerLogin.body.data.sessionToken);
  await request(app)
    .post(`/api/v1/auth/societies/${society._id}/select`)
    .set(ownerHeaders)
    .send({})
    .expect(200);

  const building = await models.Building.create({
    societyId: society._id,
    name: 'Billing tower',
    code: 'BT',
  });

  const floor = await models.Floor.create({
    societyId: society._id,
    buildingId: building._id,
    floorNumber: 1,
  });
  const flat = await models.Flat.create({
    societyId: society._id,
    buildingId: building._id,
    floorId: floor._id,
    flatNumber: '1A',
    area: 10.5,
    areaUnit: 'square_metre',
    propertyType: 'apartment',
  });
  await models.Ownership.create({
    societyId: society._id,
    flatId: flat._id,
    membershipId: ownerMembership._id,
    ownershipType: 'owner',
    status: 'active',
    startsAt: new Date('2026-01-10T00:00:00.000Z'),
    createdBy: admin._id,
  });
  const rules = await models.ChargeRules.create({
    societyId: society._id,
    version: 1,
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    frequency: 'monthly',
    areaUnit: 'square_metre',
    charges: [
      {
        code: 'base',
        name: 'Base maintenance',
        calculation: 'fixed_per_home',
        amountMinor: 3100,
      },
      {
        code: 'area',
        name: 'Area maintenance',
        calculation: 'per_area',
        amountMinor: 100,
      },
    ],
    discounts: [
      {
        code: 'concession',
        name: 'Configured concession',
        calculation: 'percentage',
        rateBasisPoints: 500,
      },
    ],
    dueDayOfPeriod: 10,
    lateFee: { type: 'percentage', rateBasisPoints: 1000, capAmountMinor: 500 },
    gracePeriodDays: 0,
    createdBy: admin._id,
  });
  assert.equal(roundHalfUp(5n, 2n), 3);
  assert.equal(multiplyRateByArea(100, 10.5, 22, 31), 745);
  assert.ok(rules._id);

  async function generateAndIssue(periodStart, periodEnd) {
    const preview = await request(app)
      .post(`/api/v1/societies/${society._id}/billing/runs/preview`)
      .set(adminHeaders)
      .send({ periodStart, periodEnd })
      .expect(201);
    const runId = preview.body.data.run._id;
    assert.equal(preview.body.data.run.preview.billCount, 1);
    for (const action of ['review', 'approve', 'issue']) {
      await request(app)
        .post(`/api/v1/societies/${society._id}/billing/runs/${runId}/${action}`)
        .set(adminHeaders)
        .send({})
        .expect(200);
    }
    return preview.body.data.bills[0];
  }

  const januaryBill = await generateAndIssue('2026-01-01', '2026-01-31');
  assert.equal(januaryBill.subtotalMinor, 2945);
  assert.equal(januaryBill.discountMinor, 147);
  assert.equal(januaryBill.totalMinor, 2798);
  await request(app)
    .post(`/api/v1/societies/${society._id}/billing/runs/preview`)
    .set(adminHeaders)
    .send({ periodStart: '2026-01-01', periodEnd: '2026-01-31' })
    .expect(409);

  const receipt = await request(app)
    .post(`/api/v1/societies/${society._id}/billing/receipts`)
    .set(adminHeaders)
    .send({
      flatId: String(flat._id),
      payerMembershipId: String(ownerMembership._id),
      amountMinor: 3000,
      method: 'bank_transfer',
      reference: 'BANK-001',
    })
    .expect(201);
  assert.equal(receipt.body.data.receipt.allocations[0].amountMinor, 2798);
  assert.equal(receipt.body.data.receipt.unappliedMinor, 202);

  const februaryBill = await generateAndIssue('2026-02-01', '2026-02-28');
  assert.equal(februaryBill.totalMinor, 3942);
  const februaryDetail = await request(app)
    .get(`/api/v1/societies/${society._id}/billing/bills/${februaryBill.id}`)
    .set(ownerHeaders)
    .expect(200);
  assert.equal(februaryDetail.body.data.paidMinor, 202);
  assert.equal(februaryDetail.body.data.outstandingMinor, 3740);
  assert.equal(februaryDetail.body.data.payments.length, 1);

  const lateFees = await request(app)
    .post(`/api/v1/societies/${society._id}/billing/late-fees/assess`)
    .set(adminHeaders)
    .send({})
    .expect(200);
  assert.equal(lateFees.body.data.created, 1);
  const repeatedLateFees = await request(app)
    .post(`/api/v1/societies/${society._id}/billing/late-fees/assess`)
    .set(adminHeaders)
    .send({})
    .expect(200);
  assert.equal(repeatedLateFees.body.data.created, 0);

  const adjustment = await request(app)
    .post(`/api/v1/societies/${society._id}/billing/bills/${februaryBill.id}/adjustments`)
    .set(adminHeaders)
    .send({
      direction: 'credit',
      category: 'adjustment',
      amountMinor: 100,
      reason: 'Correct an approved overcharge',
    })
    .expect(201);
  for (const action of ['approve', 'issue']) {
    await request(app)
      .post(
        `/api/v1/societies/${society._id}/billing/adjustments/${adjustment.body.data.adjustment._id}/${action}`,
      )
      .set(adminHeaders)
      .send({})
      .expect(200);
  }
  const adjustedBill = await request(app)
    .get(`/api/v1/societies/${society._id}/billing/bills/${februaryBill.id}`)
    .set(ownerHeaders)
    .expect(200);
  assert.equal(adjustedBill.body.data.outstandingMinor, 4014);
  const excessCredit = await request(app)
    .post(`/api/v1/societies/${society._id}/billing/bills/${februaryBill.id}/adjustments`)
    .set(adminHeaders)
    .send({
      direction: 'credit',
      category: 'adjustment',
      amountMinor: 5000,
      reason: 'Carry forward the verified excess credit',
    })
    .expect(201);
  for (const action of ['approve', 'issue']) {
    await request(app)
      .post(
        `/api/v1/societies/${society._id}/billing/adjustments/${excessCredit.body.data.adjustment._id}/${action}`,
      )
      .set(adminHeaders)
      .send({})
      .expect(200);
  }
  const creditedBill = await request(app)
    .get(`/api/v1/societies/${society._id}/billing/bills/${februaryBill.id}`)
    .set(ownerHeaders)
    .expect(200);
  assert.equal(creditedBill.body.data.outstandingMinor, 0);
  assert.equal(creditedBill.body.data.availableCreditMinor, 986);

  await request(app)
    .post(`/api/v1/societies/${society._id}/billing/bills/${januaryBill.id}/cancel`)
    .set(adminHeaders)
    .send({ reason: 'Attempt to cancel a bill that has a receipt' })
    .expect(409);
  const pdf = await request(app)
    .get(`/api/v1/societies/${society._id}/billing/bills/${februaryBill.id}/pdf`)
    .set(ownerHeaders)
    .expect(200);
  assert.match(pdf.headers['content-type'], /application\/pdf/);
  assert.ok(pdf.body.length > 500);

  await models.ChargeRules.create({
    societyId: society._id,
    version: 2,
    effectiveFrom: new Date('2026-03-01T00:00:00.000Z'),
    frequency: 'monthly',
    areaUnit: 'square_metre',
    charges: [
      { code: 'base', name: 'Base maintenance', calculation: 'fixed_per_home', amountMinor: 3200 },
      { code: 'area', name: 'Area maintenance', calculation: 'per_area', amountMinor: 100 },
    ],
    discounts: [
      {
        code: 'concession',
        name: 'Configured concession',
        calculation: 'percentage',
        rateBasisPoints: 500,
      },
    ],
    dueDayOfPeriod: 10,
    lateFee: { type: 'percentage', rateBasisPoints: 1000, capAmountMinor: 500 },
    gracePeriodDays: 0,
    createdBy: admin._id,
  });
  const preservedFebruary = await models.MaintenanceBill.findById(februaryBill.id).lean();
  assert.equal(preservedFebruary.chargeRuleVersion, 1);
  assert.equal(preservedFebruary.calculationSnapshot.chargeRules.charges[0].amountMinor, 3100);

  const otherFlat = await models.Flat.create({
    societyId: society._id,
    buildingId: building._id,
    floorId: floor._id,
    flatNumber: '1B',
    area: 12,
    areaUnit: 'square_metre',
    propertyType: 'apartment',
  });
  await models.Ownership.create({
    societyId: society._id,
    flatId: otherFlat._id,
    membershipId: otherOwnerMembership._id,
    ownershipType: 'owner',
    status: 'active',
    startsAt: new Date('2026-01-01T00:00:00.000Z'),
    createdBy: admin._id,
  });
  const otherBill = await request(app)
    .post(`/api/v1/societies/${society._id}/billing/ad-hoc`)
    .set(adminHeaders)
    .send({
      flatId: String(otherFlat._id),
      amountMinor: 500,
      description: 'Separate flat charge',
      reason: 'Approved building repair',
      dueDate: '2026-11-10',
    })
    .expect(201);
  for (const action of ['review', 'approve', 'issue']) {
    await request(app)
      .post(
        `/api/v1/societies/${society._id}/billing/bills/${otherBill.body.data.bill.id}/${action}`,
      )
      .set(adminHeaders)
      .send({})
      .expect(200);
  }
  await request(app)
    .get(`/api/v1/societies/${society._id}/billing/bills/${otherBill.body.data.bill.id}`)
    .set(ownerHeaders)
    .expect(404);
  await request(app)
    .get(`/api/v1/societies/${otherSociety._id}/billing/bills`)
    .set(adminHeaders)
    .expect(404);

  const marchPreview = await request(app)
    .post(`/api/v1/societies/${society._id}/billing/runs/preview`)
    .set(adminHeaders)
    .send({ periodStart: '2026-03-01', periodEnd: '2026-03-31' })
    .expect(201);
  const marchRunId = marchPreview.body.data.run._id;
  for (const action of ['review', 'approve', 'issue']) {
    await request(app)
      .post(`/api/v1/societies/${society._id}/billing/runs/${marchRunId}/${action}`)
      .set(adminHeaders)
      .send({})
      .expect(200);
  }
  const marchOwnerBill = marchPreview.body.data.bills.find(
    (bill) => bill.flatId === String(flat._id),
  );
  const marchOwnerDetail = await request(app)
    .get(`/api/v1/societies/${society._id}/billing/bills/${marchOwnerBill.id}`)
    .set(ownerHeaders)
    .expect(200);
  assert.equal(marchOwnerDetail.body.data.paidMinor, 0);
  assert.equal(marchOwnerDetail.body.data.availableCreditMinor, 0);
  assert.equal(
    marchOwnerDetail.body.data.outstandingMinor,
    marchOwnerDetail.body.data.totalMinor - 986,
  );
  assert.ok(
    marchOwnerDetail.body.data.notes.some(
      (note) => String(note._id) === String(excessCredit.body.data.adjustment._id),
    ),
  );
  const otherOwnerMarchBill = marchPreview.body.data.bills.find(
    (bill) => bill.flatId === String(otherFlat._id),
  );
  assert.ok(otherOwnerMarchBill);
  const marchSnapshot = await models.MaintenanceBill.findById(otherOwnerMarchBill.id).lean();
  assert.equal(marchSnapshot.chargeRuleVersion, 2);
  await request(app)
    .get(`/api/v1/societies/${society._id}/billing/bills/${otherOwnerMarchBill.id}/pdf`)
    .set(ownerHeaders)
    .expect(404);
  await request(app)
    .post(`/api/v1/societies/${society._id}/billing/bills/${otherOwnerMarchBill.id}/cancel`)
    .set(adminHeaders)
    .send({ reason: 'Correct the original recurring charge before payment' })
    .expect(200);
  const revised = await request(app)
    .post(`/api/v1/societies/${society._id}/billing/bills/${otherOwnerMarchBill.id}/revisions`)
    .set(adminHeaders)
    .send({
      reason: 'Use the approved corrected amount',
      items: [
        {
          code: 'corrected-maintenance',
          description: 'Corrected maintenance amount',
          category: 'maintenance',
          calculation: 'manual',
          rateMinor: 600,
          quantity: 1,
          amountMinor: 600,
        },
      ],
    })
    .expect(201);
  assert.equal(revised.body.data.bill.revision, 2);
  assert.equal(revised.body.data.bill.totalMinor, 600);
  assert.equal(otherOwnerMarchBill.totalMinor, 4180);
  for (const action of ['review', 'approve', 'issue']) {
    await request(app)
      .post(`/api/v1/societies/${society._id}/billing/bills/${revised.body.data.bill.id}/${action}`)
      .set(adminHeaders)
      .send({})
      .expect(200);
  }
  await request(app)
    .get(`/api/v1/societies/${society._id}/billing/bills/${revised.body.data.bill.id}`)
    .set(ownerHeaders)
    .expect(404);

  const openingImport = {
    sourceReference: 'verified-opening-ledger-2026',
    sourceTotalMinor: 600,
    rows: [
      {
        flatId: String(flat._id),
        amountMinor: 600,
        description: 'Opening receivable',
        reason: 'Verified against signed prior-year register',
        dueDate: '2026-04-01',
      },
    ],
  };
  await request(app)
    .post(`/api/v1/societies/${society._id}/billing/opening-balances/import`)
    .set(adminHeaders)
    .send(openingImport)
    .expect(201);
  await request(app)
    .post(`/api/v1/societies/${society._id}/billing/opening-balances/import`)
    .set(adminHeaders)
    .send(openingImport)
    .expect(409);
  assert.equal(
    await models.AuditLog.countDocuments({
      societyId: society._id,
      action: 'billing.opening_balance.import',
    }),
    1,
  );
});

test('Razorpay callbacks, refunds, double-entry finance, and bank reconciliation are verified and idempotent', async () => {
  const admin = await createUser({ email: 'finance-admin@example.test' });
  const owner = await createUser({ email: 'finance-owner@example.test' });
  const society = await createSociety('finance-society');
  await addMembership(admin, society);
  const ownerMembership = await addMembership(owner, society, 'house_owner');
  await models.SocietySettings.create({ societyId: society._id, currency: 'INR' });
  const adminHeaders = bearer((await login(admin.email)).body.data.sessionToken);
  const ownerHeaders = bearer((await login(owner.email)).body.data.sessionToken);
  for (const [headers] of [[adminHeaders], [ownerHeaders]]) {
    await request(app)
      .post(`/api/v1/auth/societies/${society._id}/select`)
      .set(headers)
      .send({})
      .expect(200);
  }

  const building = await models.Building.create({
    societyId: society._id,
    name: 'Finance Tower',
    code: 'FT',
  });
  const floor = await models.Floor.create({
    societyId: society._id,
    buildingId: building._id,
    floorNumber: 1,
  });
  const flat = await models.Flat.create({
    societyId: society._id,
    buildingId: building._id,
    floorId: floor._id,
    flatNumber: 'F-1',
    area: 80,
    areaUnit: 'square_metre',
    propertyType: 'apartment',
  });
  await models.Ownership.create({
    societyId: society._id,
    flatId: flat._id,
    membershipId: ownerMembership._id,
    ownershipType: 'owner',
    status: 'active',
    startsAt: new Date('2026-01-01T00:00:00.000Z'),
    createdBy: admin._id,
  });
  const bill = await models.MaintenanceBill.create({
    societyId: society._id,
    flatId: flat._id,
    periodStart: new Date('2026-10-01T00:00:00.000Z'),
    periodEnd: new Date('2026-10-31T00:00:00.000Z'),
    dueDate: new Date('2026-10-10T00:00:00.000Z'),
    revision: 1,
    source: 'recurring',
    status: 'approved',
    invoiceNumber: 'INV-FINANCE-001',
    currency: 'INR',
    calculationSnapshot: {
      flatArea: 80,
      flatAreaUnit: 'square_metre',
      ownershipDays: 31,
      periodDays: 31,
      ownerMembershipIds: [ownerMembership._id],
      chargeRules: {},
    },
    ownerMembershipIds: [ownerMembership._id],
    subtotalMinor: 1000,
    discountMinor: 0,
    totalMinor: 1000,
    createdBy: admin._id,
    issuedBy: admin._id,
    issuedAt: new Date(),
  });
  await request(app)
    .post(`/api/v1/societies/${society._id}/billing/bills/${bill._id}/issue`)
    .set(adminHeaders)
    .send({})
    .expect(200);

  const financeRoot = `/api/v1/societies/${society._id}/finance`;
  const gateway = await request(app)
    .put(`${financeRoot}/gateway`)
    .set(adminHeaders)
    .send({
      keyId: 'rzp_test_finance',
      keySecret: 'test-razorpay-key-secret',
      webhookSecret: 'test-webhook-secret',
    })
    .expect(200);
  assert.equal(gateway.body.data.configured, true);
  assert.equal(JSON.stringify(gateway.body).includes('test-razorpay-key-secret'), false);
  assert.equal(JSON.stringify(gateway.body).includes('test-webhook-secret'), false);
  assert.equal(
    (
      await models.PaymentGatewayAccount.findOne({ societyId: society._id })
        .select('+encryptedKeySecret')
        .lean()
    ).encryptedKeySecret.includes('test-razorpay-key-secret'),
    false,
  );

  const createOnlinePayment = (amountMinor, idempotencyKey) =>
    request(app)
      .post(`${financeRoot}/payments`)
      .set(ownerHeaders)
      .send({ billId: String(bill._id), amountMinor, idempotencyKey });
  const capturedOrder = await createOnlinePayment(400, 'owner-payment-capture-0001').expect(201);
  const capturedPayment = capturedOrder.body.data.payment;
  const repeatedOrder = await createOnlinePayment(400, 'owner-payment-capture-0001').expect(201);
  assert.equal(repeatedOrder.body.data.payment.id, capturedPayment.id);
  assert.match(capturedOrder.body.data.shortUrl, /^https:\/\/rzp\.io\//);
  assert.equal(capturedOrder.body.data.methodAvailability.includes('UPI'), true);
  providerPayments.set('pay_finance_captured', {
    id: 'pay_finance_captured',
    status: 'captured',
    amount: 400,
    currency: 'INR',
    payment_link_id: capturedPayment.providerReference,
    method: 'upi',
  });
  const webhook = (eventId, event) => {
    const raw = Buffer.from(JSON.stringify(event));
    const signature = crypto.createHmac('sha256', 'test-webhook-secret').update(raw).digest('hex');
    return request(app)
      .post(`/api/v1/webhooks/razorpay/${society._id}`)
      .set('content-type', 'application/json')
      .set('x-razorpay-signature', signature)
      .set('x-razorpay-event-id', eventId)
      .send(raw.toString('utf8'));
  };
  await request(app)
    .post(`/api/v1/webhooks/razorpay/${society._id}`)
    .set('content-type', 'application/json')
    .set('x-razorpay-signature', 'invalid-signature')
    .set('x-razorpay-event-id', 'evt_invalid_signature_001')
    .send(JSON.stringify({ event: 'payment.captured' }))
    .expect(401);
  const mismatchedOrder = await createOnlinePayment(100, 'owner-payment-mismatch-0001').expect(201);
  const mismatchedPayment = mismatchedOrder.body.data.payment;
  providerPayments.set('pay_finance_mismatch', {
    id: 'pay_finance_mismatch',
    status: 'captured',
    amount: 101,
    currency: 'INR',
    payment_link_id: mismatchedPayment.providerReference,
    method: 'card',
  });
  await webhook('evt_amount_mismatch_001', {
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: 'pay_finance_mismatch',
          payment_link_id: mismatchedPayment.providerReference,
          amount: 100,
          currency: 'INR',
          method: 'card',
        },
      },
    },
  }).expect(422);
  assert.equal((await models.Payment.findById(mismatchedPayment.id).lean()).status, 'pending');
  await request(app).get(`${financeRoot}/accounts`).set(ownerHeaders).expect(403);
  const unrelatedSociety = await createSociety('finance-unrelated-society');
  await request(app)
    .get(`/api/v1/societies/${unrelatedSociety._id}/finance/accounts`)
    .set(adminHeaders)
    .expect(404);

  const capturedEvent = {
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: 'pay_finance_captured',
          payment_link_id: capturedPayment.providerReference,
          amount: 400,
          currency: 'INR',
          method: 'upi',
        },
      },
    },
  };
  await webhook('evt_capture_001', capturedEvent).expect(200);
  const duplicate = await webhook('evt_capture_001', capturedEvent).expect(200);
  assert.equal(duplicate.body.duplicate, true);
  const savedCapture = await models.Payment.findById(capturedPayment.id).lean();
  assert.equal(savedCapture.status, 'captured');
  assert.equal(
    await models.Payment.countDocuments({
      societyId: society._id,
      providerPaymentId: 'pay_finance_captured',
    }),
    1,
  );
  assert.equal(
    await models.Receipt.countDocuments({ societyId: society._id, paymentId: capturedPayment.id }),
    1,
  );
  assert.equal(
    await models.JournalEntry.countDocuments({
      societyId: society._id,
      sourceType: 'receipt',
      sourceId: savedCapture.receiptId,
    }),
    1,
  );

  const failedOrder = await createOnlinePayment(100, 'owner-payment-failed-0001').expect(201);
  const failedPayment = failedOrder.body.data.payment;
  providerPayments.set('pay_finance_failed', {
    id: 'pay_finance_failed',
    status: 'failed',
    amount: 100,
    currency: 'INR',
    payment_link_id: failedPayment.providerReference,
    method: 'card',
    error_code: 'BAD_REQUEST_ERROR',
    error_description: 'Payment declined',
  });
  await webhook('evt_failed_001', {
    event: 'payment.failed',
    payload: {
      payment: {
        entity: {
          id: 'pay_finance_failed',
          payment_link_id: failedPayment.providerReference,
          amount: 100,
          currency: 'INR',
          method: 'card',
        },
      },
    },
  }).expect(200);
  const failedSaved = await models.Payment.findById(failedPayment.id).lean();
  assert.equal(failedSaved.status, 'failed');
  assert.equal(failedSaved.receiptId, null);

  const failedRefund = await request(app)
    .post(`${financeRoot}/payments/${capturedPayment.id}/refunds`)
    .set(adminHeaders)
    .send({ amountMinor: 100, reason: 'Record failed provider refund for test' })
    .expect(201);
  const failedRefundId = String(failedRefund.body.data.payment.refunds[0]._id);
  await request(app)
    .post(`${financeRoot}/payments/${capturedPayment.id}/refunds/${failedRefundId}/approve`)
    .set(adminHeaders)
    .send({})
    .expect(200);
  const firstStoredPayment = await models.Payment.findById(capturedPayment.id).lean();
  const firstRefund = firstStoredPayment.refunds[0];
  await webhook('evt_refund_failed_001', {
    event: 'refund.failed',
    payload: {
      refund: {
        entity: {
          id: firstRefund.providerRefundId,
          payment_id: 'pay_finance_captured',
          amount: 100,
          status: 'failed',
        },
      },
    },
  }).expect(200);
  assert.equal(
    (await models.Payment.findById(capturedPayment.id).lean()).refunds[0].status,
    'failed',
  );

  const secondRefund = await request(app)
    .post(`${financeRoot}/payments/${capturedPayment.id}/refunds`)
    .set(adminHeaders)
    .send({ amountMinor: 200, reason: 'Approved partial payment reversal' })
    .expect(201);
  const secondRefundId = String(secondRefund.body.data.payment.refunds[1]._id);
  await request(app)
    .post(`${financeRoot}/payments/${capturedPayment.id}/refunds/${secondRefundId}/approve`)
    .set(adminHeaders)
    .send({})
    .expect(200);
  const paidRecord = await models.Payment.findById(capturedPayment.id).lean();
  const approvedRefund = paidRecord.refunds.find(({ _id }) => String(_id) === secondRefundId);
  await webhook('evt_refund_processed_001', {
    event: 'refund.processed',
    payload: {
      refund: {
        entity: {
          id: approvedRefund.providerRefundId,
          payment_id: 'pay_finance_captured',
          amount: 200,
          status: 'processed',
        },
      },
    },
  }).expect(200);
  assert.equal((await models.Payment.findById(capturedPayment.id).lean()).refundedMinor, 200);
  const ownerBill = await request(app)
    .get(`/api/v1/societies/${society._id}/billing/bills/${bill._id}`)
    .set(ownerHeaders)
    .expect(200);
  assert.equal(ownerBill.body.data.outstandingMinor, 800);

  const accounts = (await request(app).get(`${financeRoot}/accounts`).set(adminHeaders).expect(200))
    .body.data.accounts;
  const bankAccount = accounts.find(({ systemKey }) => systemKey === 'bank');
  const expenseAccount = accounts.find(({ systemKey }) => systemKey === 'general_expense');
  const vendor = await request(app)
    .post(`${financeRoot}/vendors`)
    .set(adminHeaders)
    .send({ name: 'Verified maintenance vendor', phone: '+911234567890' })
    .expect(201);
  const expense = await request(app)
    .post(`${financeRoot}/expenses`)
    .set(adminHeaders)
    .send({
      vendorId: vendor.body.data.vendor._id,
      expenseAccountId: expenseAccount._id,
      amountMinor: 500,
      currency: 'INR',
      incurredAt: new Date().toISOString(),
      description: 'Pump repair',
      reference: 'INV-PUMP-01',
      supportingDocument: 'invoice-ref:INV-PUMP-01',
    })
    .expect(201);
  assert.equal(expense.body.data.expense.status, 'pending_approval');
  const approvedExpense = await request(app)
    .post(`${financeRoot}/expenses/${expense.body.data.expense._id}/approve`)
    .set(adminHeaders)
    .send({})
    .expect(200);
  assert.equal(approvedExpense.body.data.expense.status, 'posted');
  const expenseJournal = await models.JournalEntry.findById(
    approvedExpense.body.data.expense.journalEntryId,
  ).lean();
  assert.equal(expenseJournal.debitTotalMinor, expenseJournal.creditTotalMinor);
  const paidExpense = await request(app)
    .post(`${financeRoot}/expenses/${expense.body.data.expense._id}/payments`)
    .set(adminHeaders)
    .send({ amountMinor: 100, method: 'bank_transfer', reference: 'BANK-VENDOR-1' })
    .expect(200);
  assert.equal(paidExpense.body.data.expense.status, 'partially_paid');
  await request(app)
    .post(`${financeRoot}/expenses/${expense.body.data.expense._id}/reverse`)
    .set(adminHeaders)
    .send({ reason: 'Cannot reverse expense with posted vendor payment' })
    .expect(409);
  const vendorPayment = paidExpense.body.data.expense.vendorPayments[0];
  const reversedVendorPayment = await request(app)
    .post(
      `${financeRoot}/expenses/${expense.body.data.expense._id}/payments/${vendorPayment._id}/reverse`,
    )
    .set(adminHeaders)
    .send({ reason: 'Vendor transfer was returned by the bank' })
    .expect(200);
  assert.equal(reversedVendorPayment.body.data.expense.paidMinor, 0);
  assert.equal(reversedVendorPayment.body.data.expense.status, 'posted');
  const vendorPaymentReversal = await models.JournalEntry.findById(
    reversedVendorPayment.body.data.expense.vendorPayments[0].reversalJournalEntryId,
  ).lean();
  assert.equal(vendorPaymentReversal.debitTotalMinor, vendorPaymentReversal.creditTotalMinor);
  assert.equal(vendorPaymentReversal.reversalOf.toString(), vendorPayment.journalEntryId);
  await request(app)
    .post(
      `${financeRoot}/expenses/${expense.body.data.expense._id}/payments/${vendorPayment._id}/reverse`,
    )
    .set(adminHeaders)
    .send({ reason: 'Duplicate reversal attempt' })
    .expect(409);
  const reversedPaidExpense = await request(app)
    .post(`${financeRoot}/expenses/${expense.body.data.expense._id}/reverse`)
    .set(adminHeaders)
    .send({ reason: 'Vendor payment returned and expense cancelled' })
    .expect(200);
  assert.equal(reversedPaidExpense.body.data.expense.status, 'reversed');

  const reversalExpense = await request(app)
    .post(`${financeRoot}/expenses`)
    .set(adminHeaders)
    .send({
      vendorId: vendor.body.data.vendor._id,
      expenseAccountId: expenseAccount._id,
      amountMinor: 200,
      currency: 'INR',
      incurredAt: new Date().toISOString(),
      description: 'Duplicate un-paid invoice',
      reference: 'INV-DUP-01',
    })
    .expect(201);
  const reversalApproved = await request(app)
    .post(`${financeRoot}/expenses/${reversalExpense.body.data.expense._id}/approve`)
    .set(adminHeaders)
    .send({})
    .expect(200);
  const reversed = await request(app)
    .post(`${financeRoot}/expenses/${reversalExpense.body.data.expense._id}/reverse`)
    .set(adminHeaders)
    .send({ reason: 'Duplicate invoice voided before payment' })
    .expect(200);
  assert.equal(reversed.body.data.expense.status, 'reversed');
  const reversalJournal = await models.JournalEntry.findById(
    reversed.body.data.expense.reversalJournalEntryId,
  ).lean();
  assert.equal(reversalJournal.debitTotalMinor, reversalJournal.creditTotalMinor);
  assert.equal(
    reversalJournal.reversalOf.toString(),
    reversalApproved.body.data.expense.journalEntryId,
  );

  const settlement = await request(app)
    .post(`${financeRoot}/settlements`)
    .set(adminHeaders)
    .send({
      bankAccountId: String(bankAccount._id),
      reference: 'RZP-SETTLE-001',
      amountMinor: 200,
      settledAt: new Date().toISOString(),
    })
    .expect(201);
  assert.equal(
    settlement.body.data.journalEntry.debitTotalMinor,
    settlement.body.data.journalEntry.creditTotalMinor,
  );
  const csv = [
    'Date,Description,Ref,Debit,Credit,Balance',
    `${new Date().toISOString().slice(0, 10)},Razorpay settlement,RZP-SETTLE-001,0,2.00,2.00`,
  ].join('\n');
  const importedResponse = await request(app)
    .post(`${financeRoot}/reconciliation/import`)
    .set(adminHeaders)
    .send({
      accountId: String(bankAccount._id),
      sourceName: 'bank-october.csv',
      csv,
      mapping: {
        date: 'Date',
        description: 'Description',
        reference: 'Ref',
        debit: 'Debit',
        credit: 'Credit',
        balance: 'Balance',
      },
    });
  assert.equal(importedResponse.status, 201, JSON.stringify(importedResponse.body));
  const imported = importedResponse;
  const statementLine = imported.body.data.lines[0];
  const matchResponse = await request(app)
    .post(`${financeRoot}/reconciliation/lines/${statementLine._id}/match`)
    .set(adminHeaders)
    .send({ journalEntryId: settlement.body.data.journalEntry._id });
  assert.equal(
    matchResponse.status,
    200,
    JSON.stringify({
      response: matchResponse.body,
      line: statementLine,
      journalEntry: settlement.body.data.journalEntry,
    }),
  );
  const reconciliation = await request(app)
    .get(`${financeRoot}/reconciliation/lines?importId=${imported.body.data.statement._id}`)
    .set(adminHeaders)
    .expect(200);
  assert.equal(reconciliation.body.data.summary.transactionCount, 1);
  assert.equal(reconciliation.body.data.summary.matchedCount, 1);
  assert.equal(reconciliation.body.data.summary.unmatchedCount, 0);

  const reports = await request(app)
    .get(`${financeRoot}/reports/summary?from=2026-01-01T00:00:00.000Z&to=2027-01-01T00:00:00.000Z`)
    .set(adminHeaders)
    .expect(200);
  assert.equal(reports.body.data.currency, 'INR');
  assert.equal(reports.body.data.collectedMinor, 400);
  assert.equal(reports.body.data.expensesPostedMinor, 0);
  assert.equal(reports.body.data.duesMinor, 800);
  const ledgerEntries = await models.JournalEntry.find({ societyId: society._id }).lean();
  assert.ok(ledgerEntries.length >= 5);
  assert.ok(
    ledgerEntries.every(
      ({ debitTotalMinor, creditTotalMinor }) => debitTotalMinor === creditTotalMinor,
    ),
  );
});

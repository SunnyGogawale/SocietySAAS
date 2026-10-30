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

test('platform invitation creates a society admin account and a verified acceptance is one-use', async () => {
  const superAdmin = await createPlatformAdmin();
  const platformLogin = await login(superAdmin.email);
  const headers = bearer(platformLogin.body.data.sessionToken);
  const societyResponse = await request(app)
    .post('/api/v1/platform/societies')
    .set(headers)
    .send({ name: 'Cedar Court', slug: 'cedar-court' })
    .expect(201);
  const societyId = societyResponse.body.data.society.id;

  await request(app)
    .post(`/api/v1/platform/societies/${societyId}/invitations`)
    .set(headers)
    .send({ email: 'admin@example.test' })
    .expect(201);
  assert.equal(delivery.invitations.length, 1);

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
  const society = await request(localApp)
    .post('/api/v1/platform/societies')
    .set(headers)
    .send({ name: 'Verification Society', slug: 'verification-society' })
    .expect(201);
  await request(localApp)
    .post(`/api/v1/platform/societies/${society.body.data.society.id}/invitations`)
    .set(headers)
    .send({ email: 'unverified-admin@example.test' })
    .expect(201);
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

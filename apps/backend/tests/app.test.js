const assert = require('node:assert/strict');
const test = require('node:test');
const pino = require('pino');
const request = require('supertest');
const { createApp } = require('../src/app');

function createTestApp({ database = 'connected', requestBodyLimit = '1mb' } = {}) {
  const logger = pino({ enabled: false });
  const healthService = {
    getHealth: () => ({
      status: 'ok',
      service: 'backend',
      database,
      uptimeSeconds: 1,
    }),
    getReadiness: () => ({
      ready: database === 'connected',
      service: 'backend',
      database,
    }),
  };

  return {
    app: createApp({
      config: {
        corsOrigins: ['http://localhost:5173'],
        requestBodyLimit,
        nodeEnv: 'test',
      },
      logger,
      healthService,
    }),
  };
}

test('health endpoint returns a request ID and success envelope', async () => {
  const { app } = createTestApp();
  const response = await request(app).get('/api/v1/health').expect(200);

  assert.equal(response.body.success, true);
  assert.equal(response.body.data.database, 'connected');
  assert.equal(response.headers['x-request-id'], response.body.requestId);
});

test('readiness reports an unavailable database with a 503 response', async () => {
  const { app } = createTestApp({ database: 'disconnected' });
  const response = await request(app).get('/api/v1/ready').expect(503);

  assert.equal(response.body.success, true);
  assert.equal(response.body.data.ready, false);
});

test('unknown paths use the shared error response convention', async () => {
  const { app } = createTestApp();
  const response = await request(app).get('/unknown').expect(404);

  assert.equal(response.body.success, false);
  assert.equal(response.body.error.code, 'not_found');
  assert.equal(response.body.requestId, response.headers['x-request-id']);
});

test('security headers are applied and the server banner is disabled', async () => {
  const { app } = createTestApp();
  const response = await request(app).get('/api/v1/health').expect(200);

  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-powered-by'], undefined);
});

test('CORS only reflects configured origins', async () => {
  const { app } = createTestApp();
  const allowed = await request(app)
    .get('/api/v1/health')
    .set('Origin', 'http://localhost:5173')
    .expect(200);
  assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:5173');

  const denied = await request(app)
    .get('/api/v1/health')
    .set('Origin', 'https://untrusted.example')
    .expect(403);
  assert.equal(denied.body.error.code, 'cors_origin_denied');
});

test('health query parameters are validated with the shared error convention', async () => {
  const { app } = createTestApp();
  const response = await request(app).get('/api/v1/health?unexpected=true').expect(422);

  assert.equal(response.body.success, false);
  assert.equal(response.body.error.code, 'validation_failed');
});

test('oversized request bodies receive a safe 413 response', async () => {
  const { app } = createTestApp({ requestBodyLimit: '1kb' });
  const response = await request(app)
    .post('/api/v1/health')
    .send({ content: 'a'.repeat(2048) })
    .expect(413);

  assert.equal(response.body.error.code, 'request_too_large');
});

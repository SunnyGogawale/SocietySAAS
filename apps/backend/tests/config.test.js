const assert = require('node:assert/strict');
const test = require('node:test');
const { loadConfig } = require('../src/config/env');

test('environment configuration parses allowed origins and typed values', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    PORT: '4100',
    MONGODB_URI: 'mongodb://localhost/test',
    CORS_ORIGINS: 'https://web.example,https://admin.example',
    REQUEST_BODY_LIMIT: '2mb',
    LOG_LEVEL: 'warn',
  });

  assert.equal(config.port, 4100);
  assert.deepEqual(config.corsOrigins, ['https://web.example', 'https://admin.example']);
  assert.equal(config.requestBodyLimit, '2mb');
  assert.equal(config.sessionTtlDays, 7);
  assert.equal(config.authRateLimitMax, 10);
  assert.equal(config.smtp, null);
});

test('invalid configuration fails with a useful message', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'invalid', PORT: '0' }),
    /Invalid environment configuration/,
  );
});

test('email verification cannot be required without a configured SMTP transport', () => {
  assert.throws(
    () => loadConfig({ EMAIL_VERIFICATION_REQUIRED: 'true' }),
    /SMTP must be configured/,
  );
});

test('partial SMTP configuration fails explicitly', () => {
  assert.throws(
    () => loadConfig({ SMTP_HOST: 'mail.example.test', SMTP_USER: 'mailer' }),
    /must be configured together/,
  );
});

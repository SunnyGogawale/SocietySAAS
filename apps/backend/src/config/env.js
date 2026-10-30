const path = require('node:path');
const dotenv = require('dotenv');
const { z } = require('zod');

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/societysaas_dev'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:8081'),
  REQUEST_BODY_LIMIT: z
    .string()
    .regex(/^\d+(kb|mb|gb)$/i)
    .default('1mb'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  INVITATION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  EMAIL_VERIFICATION_REQUIRED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  WEB_APP_URL: z.string().url().default('http://localhost:5173'),
  EMAIL_FROM: z.string().min(1).default('SocietySAAS <no-reply@example.test>'),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(86400000).default(900000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000).default(10),
  PAYMENT_CREDENTIAL_ENCRYPTION_KEY: z.string().default(''),
});

function loadConfig(environment = process.env) {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${formatted}`);
  }

  const smtpValues = [result.data.SMTP_HOST, result.data.SMTP_USER, result.data.SMTP_PASSWORD];
  if (smtpValues.some(Boolean) && !smtpValues.every(Boolean)) {
    throw new Error(
      'Invalid environment configuration: SMTP_HOST, SMTP_USER, and SMTP_PASSWORD must be configured together',
    );
  }
  if (result.data.EMAIL_VERIFICATION_REQUIRED && !result.data.SMTP_HOST) {
    throw new Error(
      'Invalid environment configuration: SMTP must be configured when email verification is required',
    );
  }

  return {
    nodeEnv: result.data.NODE_ENV,
    port: result.data.PORT,
    mongoUri: result.data.MONGODB_URI,
    corsOrigins: result.data.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    requestBodyLimit: result.data.REQUEST_BODY_LIMIT,
    logLevel: result.data.LOG_LEVEL,
    sessionTtlDays: result.data.SESSION_TTL_DAYS,
    passwordResetTtlMinutes: result.data.PASSWORD_RESET_TTL_MINUTES,
    invitationTtlHours: result.data.INVITATION_TTL_HOURS,
    emailVerificationRequired: result.data.EMAIL_VERIFICATION_REQUIRED,
    webAppUrl: result.data.WEB_APP_URL.replace(/\/$/, ''),
    emailFrom: result.data.EMAIL_FROM,
    smtp: result.data.SMTP_HOST
      ? {
          host: result.data.SMTP_HOST,
          port: result.data.SMTP_PORT,
          secure: result.data.SMTP_SECURE,
          user: result.data.SMTP_USER,
          password: result.data.SMTP_PASSWORD,
        }
      : null,
    authRateLimitWindowMs: result.data.AUTH_RATE_LIMIT_WINDOW_MS,
    authRateLimitMax: result.data.AUTH_RATE_LIMIT_MAX,
    paymentCredentialEncryptionKey: result.data.PAYMENT_CREDENTIAL_ENCRYPTION_KEY,
  };
}

module.exports = { loadConfig };

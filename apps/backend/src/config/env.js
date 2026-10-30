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
});

function loadConfig(environment = process.env) {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${formatted}`);
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
  };
}

module.exports = { loadConfig };

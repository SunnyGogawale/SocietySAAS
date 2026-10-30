const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const { loadConfig } = require('../src/config/env');
const { createLogger } = require('../src/config/logger');
const models = require('../src/models');
const { connectDatabase, disconnectDatabase } = require('../src/db/connection');
const { hashPassword, validatePasswordPolicy } = require('../src/utils/password');

async function askPassword(interfaceInstance, prompt) {
  const write = interfaceInstance._writeToOutput.bind(interfaceInstance);
  interfaceInstance._writeToOutput = () => {};
  try {
    return await interfaceInstance.question(prompt);
  } finally {
    interfaceInstance._writeToOutput = write;
    stdout.write('\n');
  }
}

async function createSuperAdmin() {
  const config = loadConfig();
  const logger = createLogger(config);
  await connectDatabase(config.mongoUri);

  const terminal = readline.createInterface({ input: stdin, output: stdout });
  try {
    const email = (await terminal.question('Super Admin email: ')).trim().toLowerCase();
    const password = await askPassword(terminal, 'Password (12-128 characters): ');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !validatePasswordPolicy(password)) {
      throw new Error('Provide a valid email and a 12-128 character password.');
    }

    const existing = await models.User.exists({ platformRole: 'super_admin' });
    if (existing) throw new Error('A Super Admin already exists; bootstrap is one-time only.');

    const user = await models.User.create({
      email,
      displayName: 'Platform Administrator',
      passwordHash: await hashPassword(password),
      accountStatus: 'active',
      platformRole: 'super_admin',
      emailVerifiedAt: new Date(),
    });
    await models.AuditLog.create({
      actorId: user._id,
      action: 'platform.super_admin.bootstrap',
      targetType: 'user',
      targetId: String(user._id),
      outcome: 'success',
      metadata: {},
    });
    logger.info({ userId: String(user._id) }, 'Initial Super Admin created');
  } finally {
    terminal.close();
    await disconnectDatabase();
  }
}

if (require.main === module) {
  createSuperAdmin().catch((error) => {
    process.stderr.write(`Super Admin bootstrap failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { createSuperAdmin };

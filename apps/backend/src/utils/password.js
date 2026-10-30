const { createHash } = require('node:crypto');
const bcrypt = require('bcryptjs');

const PASSWORD_HASH_ROUNDS = 12;

function validatePasswordPolicy(password) {
  return typeof password === 'string' && password.length >= 12 && password.length <= 128;
}

async function hashPassword(password) {
  return bcrypt.hash(passwordDigest(password), PASSWORD_HASH_ROUNDS);
}

async function comparePassword(password, hash) {
  return bcrypt.compare(passwordDigest(password), hash);
}

function passwordDigest(password) {
  return createHash('sha256').update(password, 'utf8').digest('base64');
}

module.exports = { comparePassword, hashPassword, validatePasswordPolicy };

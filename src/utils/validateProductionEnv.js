'use strict';

const INSECURE_DEFAULTS = new Set([
  'key1_super_secret_123456',
  'key2_super_secret_987654',
  '123456',
  'tobemodified',
  'dev-secret',
  'dev-secret-key-change-this',
]);

const REQUIRED_PRODUCTION_VARS = [
  'APP_KEYS',
  'JWT_SECRET',
  'ADMIN_JWT_SECRET',
  'API_TOKEN_SALT',
  'TRANSFER_TOKEN_SALT',
  'DATABASE_PASSWORD',
  'SMSIR_API_KEY',
];

function isInsecureValue(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return true;

  const parts = value.split(',').map((item) => item.trim()).filter(Boolean);
  if (parts.length === 0) return true;

  return parts.some((part) => INSECURE_DEFAULTS.has(part.toLowerCase()));
}

function validateProductionEnv(env = process.env) {
  if (env.NODE_ENV !== 'production') {
    return { ok: true, skipped: true };
  }

  const problems = [];
  for (const key of REQUIRED_PRODUCTION_VARS) {
    if (isInsecureValue(env[key])) {
      problems.push(key);
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Missing or insecure required production environment variables: ${problems.join(', ')}`
    );
  }

  return { ok: true, skipped: false };
}

module.exports = {
  REQUIRED_PRODUCTION_VARS,
  INSECURE_DEFAULTS,
  validateProductionEnv,
};

'use strict';

const crypto = require('crypto');
const utils = require('@strapi/utils');
const { UnauthorizedError } = utils.errors;

/**
 * Constant-time comparison using SHA256 digests.
 * Hashing both inputs to fixed 32-byte buffers completely prevents timing attacks
 * and avoids leaking input length differences.
 */
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Route policy to validate X-Service-Key header against BYEMONEY_SERVICE_KEY environment variable.
 * Rejects with 401 if missing or invalid.
 * Strictly avoids logging secret keys or request headers.
 */
module.exports = (policyContext, config, { strapi } = {}) => {
  const expectedKey = process.env.BYEMONEY_SERVICE_KEY;

  if (!expectedKey) {
    throw new UnauthorizedError('Unauthorized: Service key is not configured');
  }

  const rawKey =
    (typeof policyContext.get === 'function' && policyContext.get('x-service-key')) ||
    (policyContext.request?.headers && policyContext.request.headers['x-service-key']) ||
    (policyContext.header && policyContext.header['x-service-key']);

  if (!rawKey || !safeCompare(rawKey, expectedKey)) {
    throw new UnauthorizedError('Unauthorized: Invalid or missing service key');
  }

  return true;
};

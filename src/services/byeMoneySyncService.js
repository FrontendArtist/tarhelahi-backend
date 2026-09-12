'use strict';

const IDENTITY_FIELDS = Object.freeze(['firstName', 'lastName', 'phoneNumber', 'email']);

/**
 * Normalizes an identity field value for comparison.
 * Trims whitespace, lowercases email, and converts null/undefined to empty string.
 */
function normalizeValue(field, value) {
  if (value === undefined || value === null) {
    return '';
  }
  const str = String(value).trim();
  if (field === 'email') {
    return str.toLowerCase();
  }
  return str;
}

/**
 * Checks if any identity field is present in the request payload.
 *
 * @param {object} payload - The request body.
 * @returns {boolean} True if at least one identity field is in payload.
 */
function hasIdentityFieldsInPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  return IDENTITY_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(payload, field));
}

/**
 * Compares identity fields between the pre-update user record and the update payload.
 * Returns true only if at least one identity field actually changed value.
 *
 * @param {object} userBefore - The user record before update.
 * @param {object} payload - The update request body.
 * @returns {boolean} True if any identity field changed.
 */
function hasIdentityFieldsChanged(userBefore, payload) {
  if (!userBefore || !payload || typeof payload !== 'object') {
    return false;
  }

  for (const field of IDENTITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      const oldVal = normalizeValue(field, userBefore[field]);
      const newVal = normalizeValue(field, payload[field]);
      if (oldVal !== newVal) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Issues a background, fire-and-forget sync call to ByeMoney's POST /api/auth/sync.
 * - Authenticates via Bearer token issued using the shared JWT_SECRET.
 * - Applies a short timeout via AbortController.
 * - Catches and logs all errors (timeout, network error, non-2xx response) without throwing.
 *
 * @param {object} user - The user object containing id and/or documentId.
 * @param {object} [options] - Optional configuration overrides (e.g. timeoutMs, baseUrl).
 * @returns {Promise<void>}
 */
async function syncUser(user, options = {}) {
  const userIdentifier = user?.documentId || user?.id || 'unknown';

  try {
    if (!user || (!user.id && !user.documentId)) {
      strapi.log.warn('[ByeMoneySync] Cannot trigger sync: missing user identity');
      return;
    }

    let documentId = user.documentId;
    const id = user.id;

    // Fallback: If documentId is not present on user object, fetch it from DB
    if (!documentId && id && strapi?.db?.query) {
      try {
        const dbUser = await strapi.db.query('plugin::users-permissions.user').findOne({
          where: { id },
          select: ['id', 'documentId'],
        });
        if (dbUser?.documentId) {
          documentId = dbUser.documentId;
        }
      } catch (dbErr) {
        strapi.log.warn(`[ByeMoneySync] Could not resolve documentId for user ${id}: ${dbErr.message}`);
      }
    }

    const payload = {
      id,
      ...(documentId ? { documentId } : {}),
    };

    // Issue JWT using shared JWT_SECRET via Strapi's users-permissions jwt service
    const jwtService = strapi.plugin('users-permissions').service('jwt');
    const token = await jwtService.issue(payload);

    const baseUrl = (
      options.baseUrl ||
      process.env.BYEMONEY_API_URL ||
      'http://localhost:5000'
    ).replace(/\/+$/, '');
    const url = `${baseUrl}/api/auth/sync`;

    const timeoutMs = Number(options.timeoutMs || process.env.BYEMONEY_SYNC_TIMEOUT_MS) || 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ forceSync: true }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        strapi.log.warn(
          `[ByeMoneySync] Sync request for user ${userIdentifier} failed with status ${response.status}: ${errorText}`
        );
      } else {
        strapi.log.info(
          `[ByeMoneySync] Successfully triggered sync for user ${userIdentifier} (forceSync: true)`
        );
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      strapi.log.warn(
        `[ByeMoneySync] Sync request for user ${userIdentifier} timed out after configured timeout`
      );
    } else {
      strapi.log.error(
        `[ByeMoneySync] Failed to sync user ${userIdentifier}: ${error.message}`
      );
    }
  }
}

module.exports = {
  IDENTITY_FIELDS,
  normalizeValue,
  hasIdentityFieldsInPayload,
  hasIdentityFieldsChanged,
  syncUser,
};

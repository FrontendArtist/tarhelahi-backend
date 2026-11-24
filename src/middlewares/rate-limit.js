'use strict';

const phoneUtils = require('../utils/phoneUtils');

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 50000;

const stores = new Map();

function getStore(storeKey) {
  if (!stores.has(storeKey)) {
    stores.set(storeKey, new Map());
  }
  return stores.get(storeKey);
}

function resetRateLimitStores() {
  for (const store of stores.values()) {
    store.clear();
  }
  stores.clear();
}

function getClientIp(ctx) {
  const raw =
    ctx?.ip ||
    ctx?.request?.ip ||
    ctx?.req?.socket?.remoteAddress ||
    'unknown';
  return String(raw).trim() || 'unknown';
}

function getNormalizedPhoneKey(ctx) {
  const rawPhone = ctx?.request?.body?.phoneNumber;
  if (!rawPhone || typeof rawPhone !== 'string') return '';
  const cleaned = phoneUtils.normalizeDigits(rawPhone);
  if (!cleaned) return '';
  const standardized = phoneUtils.standardizePhoneNumber(cleaned);
  if (!standardized) return '';
  return /^[Tt]/.test(standardized)
    ? phoneUtils.extractTestPhone(standardized)
    : standardized;
}

function pruneAndEnforceCap(store, now, maxEntries) {
  if (store.size < maxEntries) return;

  for (const [k, entry] of store.entries()) {
    if (entry.resetAt <= now) {
      store.delete(k);
    }
  }

  while (store.size >= maxEntries) {
    const oldestKey = store.keys().next().value;
    if (oldestKey === undefined) break;
    store.delete(oldestKey);
  }
}

function consumeBucket(store, key, limit, windowMs, now, maxEntries) {
  const existing = store.get(key);
  if (!existing || existing.resetAt <= now) {
    if (existing) {
      store.delete(key);
    }
    pruneAndEnforceCap(store, now, maxEntries);
    const fresh = { count: 1, resetAt: now + windowMs };
    store.set(key, fresh);
    return { allowed: true, remaining: Math.max(0, limit - 1), resetAt: fresh.resetAt };
  }

  // Refresh LRU order
  store.delete(key);
  existing.count += 1;
  store.set(key, existing);

  if (existing.count > limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  return { allowed: true, remaining: Math.max(0, limit - existing.count), resetAt: existing.resetAt };
}

function rateLimitMiddleware(config = {}) {
  const keyPrefix = String(config.keyPrefix || 'default');
  const windowMs = Number(config.windowMs) > 0 ? Number(config.windowMs) : DEFAULT_WINDOW_MS;
  const max = Number(config.max) > 0 ? Number(config.max) : 60;
  const phoneMax = Number(config.phoneMax) > 0 ? Number(config.phoneMax) : 0;
  const phoneWindowMs = Number(config.phoneWindowMs) > 0 ? Number(config.phoneWindowMs) : windowMs;
  const maxEntries = Number(config.maxEntries) > 0 ? Number(config.maxEntries) : DEFAULT_MAX_ENTRIES;
  const message =
    config.message ||
    'تعداد درخواست‌های شما بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید.';

  const ipStore = getStore(`${keyPrefix}:ip`);
  const phoneStore = phoneMax > 0 ? getStore(`${keyPrefix}:phone`) : null;

  return async (ctx, next) => {
    const now = Date.now();
    const ip = getClientIp(ctx);
    const ipResult = consumeBucket(ipStore, ip, max, windowMs, now, maxEntries);

    if (typeof ctx.set === 'function') {
      ctx.set('X-RateLimit-Limit', String(max));
      ctx.set('X-RateLimit-Remaining', String(ipResult.remaining));
    }

    if (!ipResult.allowed) {
      const retryAfterSec = Math.max(1, Math.ceil((ipResult.resetAt - now) / 1000));
      if (typeof ctx.set === 'function') {
        ctx.set('Retry-After', String(retryAfterSec));
      }
      ctx.status = 429;
      ctx.body = {
        error: {
          status: 429,
          name: 'TooManyRequestsError',
          message,
        },
      };
      return;
    }

    if (phoneStore) {
      const phoneKey = getNormalizedPhoneKey(ctx);
      if (phoneKey) {
        const phoneResult = consumeBucket(phoneStore, phoneKey, phoneMax, phoneWindowMs, now, maxEntries);
        if (!phoneResult.allowed) {
          const retryAfterSec = Math.max(1, Math.ceil((phoneResult.resetAt - now) / 1000));
          if (typeof ctx.set === 'function') {
            ctx.set('Retry-After', String(retryAfterSec));
          }
          ctx.status = 429;
          ctx.body = {
            error: {
              status: 429,
              name: 'TooManyRequestsError',
              message,
            },
          };
          return;
        }
      }
    }

    await next();
  };
}

rateLimitMiddleware.resetRateLimitStores = resetRateLimitStores;
rateLimitMiddleware.getNormalizedPhoneKey = getNormalizedPhoneKey;

module.exports = rateLimitMiddleware;

'use strict';

const crypto = require('crypto');
const utils = require('@strapi/utils');
const { UnauthorizedError, ForbiddenError } = utils.errors;

const ADMIN_ROLES = ['admin', 'administrator'];

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function getServiceKey(ctx) {
  return (
    (typeof ctx.get === 'function' && ctx.get('x-service-key')) ||
    (ctx.request?.headers && ctx.request.headers['x-service-key']) ||
    (ctx.header && ctx.header['x-service-key'])
  );
}

function isServiceKeyValid(ctx) {
  const expectedKey = process.env.BYEMONEY_SERVICE_KEY;
  if (!expectedKey) return false;
  const rawKey = getServiceKey(ctx);
  return Boolean(rawKey && safeCompare(rawKey, expectedKey));
}

function isAdminUser(ctx) {
  if (['admin', 'api-token'].includes(ctx.state?.auth?.strategy?.name)) {
    return true;
  }
  const roleType = ctx.state?.user?.role?.type || ctx.state?.user?.role?.name || ctx.state?.user?.role;
  return typeof roleType === 'string' && ADMIN_ROLES.includes(roleType.toLowerCase());
}

async function requireAdminOrServiceKey(ctx, next) {
  if (isServiceKeyValid(ctx) || isAdminUser(ctx)) {
    return next();
  }
  if (!ctx.state?.user && !getServiceKey(ctx)) {
    if (typeof ctx.unauthorized === 'function') {
      return ctx.unauthorized('احراز هویت ادمین یا کلید سرویس الزامی است.');
    }
    throw new UnauthorizedError('احراز هویت ادمین یا کلید سرویس الزامی است.');
  }
  if (typeof ctx.forbidden === 'function') {
    return ctx.forbidden('دسترسی فقط برای مدیر یا کلید سرویس مجاز است.');
  }
  throw new ForbiddenError('دسترسی فقط برای مدیر یا کلید سرویس مجاز است.');
}

/**
 * همگام‌سازی فهرست استان/شهر از حامل فعلی؛ فقط ادمین یا کلید سرویس (S2-08).
 * کلید حامل در پاسخ برنمی‌گردد.
 */
module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/cities/sync-localities',
      handler: 'city.syncLocalities',
      config: {
        auth: false,
        middlewares: [requireAdminOrServiceKey],
      },
    },
  ],
  requireAdminOrServiceKey,
  isServiceKeyValid,
  isAdminUser,
};

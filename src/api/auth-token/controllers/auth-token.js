'use strict';

const jsonwebtoken = require('jsonwebtoken');

const USER_UID = 'plugin::users-permissions.user';

// توکن منقضی هم پذیرفته می‌شود، چون نشست واقعی کوکی next-auth (۳۰ روز لغزان) است و فقط سرور Next
// با کلید API می‌تواند این مسیر را صدا بزند. توکنی که بیش از عمر نشست از انقضایش گذشته، از نشست زنده نمی‌آید.
const MAX_EXPIRED_AGE_SECONDS = 30 * 24 * 60 * 60;

function readRefreshablePayload(token, strapi) {
  const secret = strapi.config.get('plugin::users-permissions.jwtSecret');
  const { issuer, audience, algorithm } = strapi.config.get('plugin::users-permissions.jwt', {});
  let payload;
  try {
    payload = jsonwebtoken.verify(token, secret, {
      issuer,
      audience,
      algorithms: algorithm ? [algorithm] : undefined,
      ignoreExpiration: true,
    });
  } catch {
    return null;
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!payload?.id || typeof payload.exp !== 'number' || nowSeconds - payload.exp > MAX_EXPIRED_AGE_SECONDS) {
    return null;
  }
  return payload;
}

module.exports = ({ strapi }) => ({
  /**
   * POST /api/auth/token/refresh
   * ورودی: { jwt } توکن فعلی کاربر از نشست سروری Next. خروجی: { jwt } تازه با همان id و documentId.
   */
  async refresh(ctx) {
    if (ctx.state?.auth?.strategy?.name !== 'api-token') {
      return ctx.forbidden('تمدید توکن فقط برای سرویس سایت مجاز است.');
    }
    const token = ctx.request.body?.jwt;
    if (typeof token !== 'string' || !token) {
      return ctx.badRequest('توکن کاربر الزامی است.');
    }
    const payload = readRefreshablePayload(token, strapi);
    if (!payload) {
      return ctx.unauthorized('توکن کاربر معتبر نیست یا نشست منقضی شده است.');
    }
    const user = await strapi.db.query(USER_UID).findOne({
      where: { id: payload.id },
      select: ['id', 'documentId', 'blocked'],
    });
    if (!user || user.blocked || (payload.documentId && payload.documentId !== user.documentId)) {
      return ctx.unauthorized('حساب کاربر فعال نیست.');
    }
    const jwt = strapi.plugin('users-permissions').service('jwt').issue({
      id: user.id,
      documentId: user.documentId,
    });
    ctx.set('Cache-Control', 'no-store');
    ctx.body = { jwt };
  },
});

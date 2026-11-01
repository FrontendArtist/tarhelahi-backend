'use strict';

const UID = 'api::byemoney-cart.byemoney-cart';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// مسیر scope خالی دارد؛ پس توکن سفارشی/فقط‌خواندنی نباید فقط به‌خاطر نبودن scope عبور کند.
const canReadAddress = (ctx) => (
  (ctx.state?.auth?.strategy?.name === 'api-token' && ctx.state.auth.credentials?.type === 'full-access') ||
  ctx.state?.user?.role?.type === 'administrator'
);

module.exports = {
  /**
   * GET /api/byemoney-carts/:cartId/address
   * نسخهٔ ثابت آدرس ثبت‌شده در رزرو (I09-PH)؛ فقط‌خواندنی و فقط ادمین.
   * وضعیت ارسال، پرداخت یا رسید را برنمی‌گرداند و هیچ چیزی نمی‌نویسد.
   */
  async address(ctx) {
    if (!canReadAddress(ctx)) {
      return ctx.forbidden('خواندن آدرس رزرو فقط برای ادمین مجاز است.');
    }
    const { cartId } = ctx.params;
    if (!UUID.test(cartId || '')) {
      return ctx.badRequest('شناسهٔ سبد معتبر نیست.');
    }
    const cart = await strapi.db.query(UID).findOne({ where: { cartId } });
    if (!cart) {
      return ctx.notFound('سبد یافت نشد.');
    }
    const snapshot = cart.snapshot || {};
    if (!snapshot.addressSnapshot) {
      return ctx.notFound('این سبد آدرس تحویل ندارد.');
    }
    ctx.set('Cache-Control', 'no-store');
    ctx.body = {
      cartId: cart.cartId,
      addressSnapshot: snapshot.addressSnapshot,
      addressVersion: snapshot.addressVersion ?? null,
    };
  },
};

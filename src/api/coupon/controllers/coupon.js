'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::coupon.coupon', ({ strapi }) => ({
  /**
   * اعتبارسنجی کد تخفیف برای اقلام سبد خرید
   * POST /api/coupons/validate
   */
  async validate(ctx) {
    try {
      const { code, cartItems, currentTotal } = ctx.request.body || {};

      if (!code) {
        return ctx.badRequest('کد تخفیف ارسال نشده است.');
      }

      const result = await strapi
        .service('api::coupon.coupon')
        .validateAndCalculate(code, cartItems, currentTotal);

      if (!result.valid) {
        return ctx.send(
          {
            valid: false,
            message: result.message,
          },
          400
        );
      }

      return ctx.send(result);
    } catch (err) {
      ctx.throw(500, `خطا در بررسی کد تخفیف: ${err.message}`);
    }
  },

  /**
   * مصرف اتومیک کد تخفیف پس از ثبت سفارش
   * POST /api/coupons/consume
   */
  async consume(ctx) {
    try {
      const { code } = ctx.request.body || {};
      if (!code) {
        return ctx.badRequest('کد تخفیف ارسال نشده است.');
      }
      const result = await strapi
        .service('api::coupon.coupon')
        .consumeCoupon(code);

      if (!result.success) {
        return ctx.send(result, 400);
      }
      return ctx.send(result);
    } catch (err) {
      ctx.throw(500, `خطا در ثبت استفاده از کد تخفیف: ${err.message}`);
    }
  },
}));

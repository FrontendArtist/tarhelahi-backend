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
}));

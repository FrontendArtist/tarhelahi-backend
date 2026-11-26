'use strict';

/**
 * Custom routes for Coupon API (Validation & Application)
 */

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/coupons/validate',
      handler: 'coupon.validate',
      config: {
        auth: false, // اجازه اعتبارسنجی هم برای کاربران لاگین‌شده و هم مهمان
        policies: [],
        middlewares: [
          {
            name: 'global::rate-limit',
            config: {
              keyPrefix: 'coupon-validate',
              windowMs: 15 * 60 * 1000,
              max: 20,
            },
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/coupons/consume',
      handler: 'coupon.consume',
      config: {
        auth: { strategies: ['api-token'], scope: ['api::coupon.coupon.update'] },
        policies: [],
        middlewares: [],
      },
    },
  ],
};

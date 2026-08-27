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
        middlewares: [],
      },
    },
  ],
};

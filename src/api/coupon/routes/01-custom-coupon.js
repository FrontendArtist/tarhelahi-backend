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
    {
      method: 'POST',
      path: '/coupons/consume',
      handler: 'coupon.consume',
      config: {
        auth: false, // احراز هویت سیستمی با توکن استراپی
        policies: [],
        middlewares: [],
      },
    },
  ],
};

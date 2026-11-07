'use strict';

// فقط عدد آستانهٔ «در حال بررسی» برای کاربر لاگین‌شده؛ مالک مقدار تنظیم ادمین است (D19 §۲).
// هندلر تابعی مانع افزودن خودکار مجوز نقش توسط استرپی می‌شود؛ policy احراز کاربر، JWT را الزامی می‌کند.
module.exports = ({ strapi }) => ({
  routes: [{
    method: 'GET',
    path: '/gateway-reviews/threshold',
    handler: (ctx) => strapi.controller('api::gateway-review-case.gateway-review-case').getThreshold(ctx),
    config: { auth: { scope: [] }, policies: ['global::is-authenticated-user'] },
  }],
});

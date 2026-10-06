'use strict';

// هندلر تابعی مانع افزودن خودکار مجوز محلی استرپی هنگام ثبت مسیر می‌شود.
// اعتبار JWT همچنان در استرپی و مجوز مالی فقط در بای‌مانی بررسی می‌شود.
module.exports = ({ strapi }) => ({
  routes: [
    ['GET', '/admin/gateway-reviews/settings', 'getSettings'],
    ['PUT', '/admin/gateway-reviews/settings', 'updateSettings'],
    ['GET', '/admin/gateway-reviews', 'find'],
    ['GET', '/admin/gateway-reviews/:clientReferenceCode', 'findOne'],
    ['POST', '/admin/gateway-reviews/:clientReferenceCode/resolve', 'resolve'],
    ['POST', '/admin/gateway-reviews/:clientReferenceCode/reopen', 'reopen'],
  ].map(([method, path, action]) => ({
    method,
    path,
    handler: (ctx) => strapi.controller('api::gateway-review-case.gateway-review-case')[action](ctx),
    config: { auth: { scope: [] }, policies: ['global::has-financial-review-permission'] },
  })),
});

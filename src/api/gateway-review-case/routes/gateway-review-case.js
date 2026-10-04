'use strict';

module.exports = {
  routes: [
    { method: 'GET', path: '/admin/gateway-reviews/settings', handler: 'gateway-review-case.getSettings',
      config: { auth: { scope: ['api::gateway-review-case.gateway-review-case.find'] } } },
    { method: 'PUT', path: '/admin/gateway-reviews/settings', handler: 'gateway-review-case.updateSettings',
      config: { auth: { scope: ['api::gateway-review-case.gateway-review-case.update'] } } },
    { method: 'GET', path: '/admin/gateway-reviews', handler: 'gateway-review-case.find',
      config: { auth: { scope: ['api::gateway-review-case.gateway-review-case.find'] } } },
    { method: 'GET', path: '/admin/gateway-reviews/:clientReferenceCode', handler: 'gateway-review-case.findOne',
      config: { auth: { scope: ['api::gateway-review-case.gateway-review-case.find'] } } },
    { method: 'POST', path: '/admin/gateway-reviews/:clientReferenceCode/resolve', handler: 'gateway-review-case.resolve',
      config: { auth: { scope: ['api::gateway-review-case.gateway-review-case.update'] } } },
    { method: 'POST', path: '/admin/gateway-reviews/:clientReferenceCode/reopen', handler: 'gateway-review-case.reopen', config: {} },
  ],
};

// نقش استرپی مجوز مالی نیست؛ همه مسیرهای این بخش از بای‌مانی اجازه می‌گیرند.
for (const route of module.exports.routes) {
  route.config = { auth: { scope: [] }, policies: ['global::has-financial-review-permission'] };
}

'use strict';

/**
 * ByeMoney <-> TarhElahi Integration Routes (v1)
 * Protected only by the X-Service-Key policy (no end-user Bearer JWT auth required)
 */
module.exports = {
  routes: [
    {
      method: 'POST', path: '/course-carts/preview',
      // تابع مانع افزودن خودکار scope نقش توسط Strapi می‌شود؛ کنترلر JWT کاربر را الزام می‌کند.
      handler: ctx => strapi.controller('api::integration.integration').previewCart(ctx),
      config: { auth: { scope: [] } },
    },
    ...[
      ['/carts/prepare', 'prepareCart'],
      ['/carts/:cartId/check', 'checkCart'],
      ['/carts/:cartId/commit', 'commitCart'],
      ['/carts/:cartId/release', 'releaseCart'],
    ].map(([path, action]) => ({ method: 'POST', path: `/integrations/byemoney/v1${path}`,
      handler: `integration.${action}`, config: { auth: false, policies: ['global::is-service-authenticated'] } })),
    {
      method: 'GET',
      path: '/integrations/byemoney/v1/users/:externalUserId',
      handler: 'integration.getUser',
      config: {
        auth: false,
        policies: ['global::is-service-authenticated'],
      },
    },
    {
      method: 'GET',
      path: '/integrations/byemoney/v1/courses/:documentId',
      handler: 'integration.getCourse',
      config: {
        auth: false,
        policies: ['global::is-service-authenticated'],
      },
    },
    {
      method: 'GET',
      path: '/integrations/byemoney/v1/chapters/:externalId',
      handler: 'integration.getChapter',
      config: {
        auth: false,
        policies: ['global::is-service-authenticated'],
      },
    },
    {
      method: 'GET',
      path: '/integrations/byemoney/v1/products/:externalId',
      handler: 'integration.getProduct',
      config: {
        auth: false,
        policies: ['global::is-service-authenticated'],
      },
    },
    {
      method: 'POST',
      path: '/integrations/byemoney/v1/purchases/confirm',
      handler: 'integration.confirmPurchase',
      config: {
        auth: false,
        policies: ['global::is-service-authenticated'],
      },
    },
  ],
};

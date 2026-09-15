'use strict';

/**
 * ByeMoney <-> TarhElahi Integration Routes (v1)
 * Protected only by the X-Service-Key policy (no end-user Bearer JWT auth required)
 */
module.exports = {
  routes: [
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
      path: '/integrations/byemoney/v1/courses/:externalId',
      handler: 'integration.getCourse',
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

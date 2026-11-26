'use strict';

/**
 * visitor-stat routes
 */

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/visitor-stat/track',
      handler: 'visitor-stat.track',
      config: {
        auth: false,
        policies: [],
        middlewares: [
          {
            name: 'global::rate-limit',
            config: {
              keyPrefix: 'visitor-track',
              windowMs: 60 * 1000,
              max: 60,
            },
          },
        ],
      },
    },
    {
      method: 'GET',
      path: '/visitor-stat/stats',
      handler: 'visitor-stat.stats',
      config: {
        auth: { scope: [] },
        policies: ['global::is-admin-or-api-token'],
      },
    },
  ],
};

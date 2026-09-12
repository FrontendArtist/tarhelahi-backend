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
      },
    },
    {
      method: 'GET',
      path: '/visitor-stat/stats',
      handler: 'visitor-stat.stats',
      config: {
        auth: false,
        policies: [],
      },
    },
  ],
};

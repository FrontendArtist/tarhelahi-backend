'use strict';

/**
 * top-banner router
 * Strapi v5 — Single Type
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::top-banner.top-banner', {
  config: {
    find: {
      auth: false,
    },
  },
});

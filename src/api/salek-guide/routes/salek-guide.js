'use strict';

/**
 * salek-guide router
 * Strapi v5 — Single Type
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::salek-guide.salek-guide', {
  config: {
    find: {
      auth: false,
    },
  },
});

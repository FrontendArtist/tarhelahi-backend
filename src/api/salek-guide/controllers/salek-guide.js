'use strict';

/**
 * salek-guide controller
 * Strapi v5 — Single Type
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::salek-guide.salek-guide', ({ strapi }) => ({
  async find(ctx) {
    const existing = await strapi.documents('api::salek-guide.salek-guide').findFirst();
    if (!existing) {
      return { data: null, meta: {} };
    }
    return await super.find(ctx);
  },
}));

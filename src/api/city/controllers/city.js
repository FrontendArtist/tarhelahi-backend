'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::city.city', ({ strapi }) => ({
  /** همگام‌سازی یک‌بارهٔ استان/شهر از حامل فعلی (ادمین). */
  async syncLocalities(ctx) {
    const postexLocality = require('../../../services/postexLocalitySync');
    const result = await postexLocality.syncFromPostex(strapi);
    ctx.body = { data: result };
  },
}));

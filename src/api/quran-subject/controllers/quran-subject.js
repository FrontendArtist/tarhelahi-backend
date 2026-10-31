'use strict';

/**
 * quran-subject controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::quran-subject.quran-subject', ({ strapi }) => ({
  async find(ctx) {
    const query = ctx.query || {};
    const status = query.status === 'draft' ? 'draft' : 'published';

    const results = await strapi.documents('api::quran-subject.quran-subject').findMany({
      ...query,
      status,
    });

    return {
      data: results,
      meta: {},
    };
  },

  async findOne(ctx) {
    const { id } = ctx.params;
    const query = ctx.query || {};
    const status = query.status === 'draft' ? 'draft' : 'published';

    const entity = await strapi.documents('api::quran-subject.quran-subject').findOne({
      documentId: id,
      ...query,
      status,
    });

    return { data: entity };
  },
}));

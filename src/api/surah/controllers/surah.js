'use strict';

/**
 * surah controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::surah.surah', ({ strapi }) => ({
  async find(ctx) {
    const query = ctx.query || {};
    const status = query.status === 'draft' ? 'draft' : 'published';

    const results = await strapi.documents('api::surah.surah').findMany({
      ...query,
      status,
      populate: {
        ayeha: {
          populate: {
            ayeAudio: true,
            translationAudio: true,
            tafsirAudio: true,
            subjects: true,
          },
        },
      },
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

    const entity = await strapi.documents('api::surah.surah').findOne({
      documentId: id,
      ...query,
      status,
      populate: {
        ayeha: {
          populate: {
            ayeAudio: true,
            translationAudio: true,
            tafsirAudio: true,
            subjects: true,
          },
        },
      },
    });

    return { data: entity };
  },
}));

'use strict';

/**
 * article controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::article.article', ({ strapi }) => ({
    async update(ctx) {
        const { id } = ctx.params; // documentId in Strapi 5
        const body = ctx.request.body || {};
        const data = body.data || {};

        // Check if client passed publishedAt explicitly in the payload
        if (Object.prototype.hasOwnProperty.call(data, 'publishedAt')) {
            const { publishedAt, ...otherData } = data;

            // Update other fields first if there are any
            if (Object.keys(otherData).length > 0) {
                await strapi.documents('api::article.article').update({
                    documentId: id,
                    data: otherData,
                });
            }

            // Publish/Unpublish using the Document Service
            let entry;
            if (publishedAt === null) {
                entry = await strapi.documents('api::article.article').unpublish({
                    documentId: id,
                });
            } else {
                entry = await strapi.documents('api::article.article').publish({
                    documentId: id,
                });
            }

            return { data: entry };
        }

        // Default controller update behavior
        return await super.update(ctx);
    },
}));

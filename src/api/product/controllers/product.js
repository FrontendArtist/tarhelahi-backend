'use strict';

/**
 * product controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::product.product', ({ strapi }) => ({
    async update(ctx) {
        const { id } = ctx.params; // documentId in Strapi 5
        const body = ctx.request.body || {};
        const data = body.data || {};

        // Check if client passed publishedAt explicitly in the payload
        if (Object.prototype.hasOwnProperty.call(data, 'publishedAt')) {
            const { publishedAt, ...otherData } = data;

            // Update other fields first if there are any
            if (Object.keys(otherData).length > 0) {
                await strapi.documents('api::product.product').update({
                    documentId: id,
                    data: otherData,
                });
            }

            // Publish/Unpublish using the Document Service
            let entry;
            if (publishedAt === null) {
                entry = await strapi.documents('api::product.product').unpublish({
                    documentId: id,
                });
            } else {
                entry = await strapi.documents('api::product.product').publish({
                    documentId: id,
                });
            }

            return { data: entry };
        }

        // Default controller update behavior
        return await super.update(ctx);
    },
}));

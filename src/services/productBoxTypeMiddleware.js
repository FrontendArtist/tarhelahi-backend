'use strict';

const { errors } = require('@strapi/utils');
const postexBoxes = require('./postexBoxes');

const PRODUCT_UID = 'api::product.product';

/**
 * انتشار کالا بدون جعبهٔ استاندارد پستکس ممنوع است (SHIP-BOX-TYPE).
 */
function documentMiddleware(strapi) {
  return async (context, next) => {
    if (context.uid !== PRODUCT_UID || context.action !== 'publish') {
      return next();
    }

    const documentId = context.params?.documentId;
    if (!documentId) {
      throw new errors.ValidationError('جعبهٔ کالا تعیین نشده');
    }

    const draft = await strapi.db.query(PRODUCT_UID).findOne({
      where: { documentId, publishedAt: null },
    });
    const published = draft
      ? null
      : await strapi.db.query(PRODUCT_UID).findOne({
        where: { documentId, publishedAt: { $notNull: true } },
      });
    const row = draft || published;
    const fromParams = context.params?.data?.boxTypeId;
    const boxTypeId = fromParams != null ? fromParams : row?.boxTypeId;
    if (!postexBoxes.resolve(boxTypeId)) {
      throw new errors.ValidationError('جعبهٔ کالا تعیین نشده');
    }

    return next();
  };
}

module.exports = { documentMiddleware };

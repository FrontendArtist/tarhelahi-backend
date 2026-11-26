'use strict';

/**
 * coupon router
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

const ADMIN_OR_TOKEN_POLICY = {
  policies: ['global::is-admin-or-api-token'],
};

module.exports = createCoreRouter('api::coupon.coupon', {
  config: {
    find: ADMIN_OR_TOKEN_POLICY,
    findOne: ADMIN_OR_TOKEN_POLICY,
    create: ADMIN_OR_TOKEN_POLICY,
    update: ADMIN_OR_TOKEN_POLICY,
    delete: ADMIN_OR_TOKEN_POLICY,
  },
});

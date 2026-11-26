'use strict';

/**
 * address router
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

const OWNER_POLICY = { policies: ['api::address.is-address-owner'] };

module.exports = createCoreRouter('api::address.address', {
  config: {
    find: OWNER_POLICY,
    findOne: OWNER_POLICY,
    create: OWNER_POLICY,
    update: OWNER_POLICY,
    delete: OWNER_POLICY,
  },
});

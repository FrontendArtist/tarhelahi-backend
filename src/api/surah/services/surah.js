'use strict';

/**
 * surah service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::surah.surah');

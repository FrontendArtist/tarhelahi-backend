'use strict';

/**
 * popup-message service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::popup-message.popup-message');

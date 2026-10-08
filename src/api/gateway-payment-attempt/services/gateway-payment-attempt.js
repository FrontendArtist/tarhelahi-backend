'use strict';

const { createCoreService } = require('@strapi/strapi').factories;
module.exports = createCoreService('api::gateway-payment-attempt.gateway-payment-attempt');

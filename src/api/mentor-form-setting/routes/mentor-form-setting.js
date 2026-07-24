'use strict';

/**
 * mentor-form-setting router
 * Strapi v5 — Single Type
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::mentor-form-setting.mentor-form-setting', {
    config: {
        find: {
            auth: false,
        },
    },
});

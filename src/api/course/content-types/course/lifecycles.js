'use strict';

const { validateCourseEvent } = require('../../../../services/chapterIdentity');

module.exports = {
  async beforeCreate(event) {
    await validateCourseEvent(strapi, event);
  },
  async beforeUpdate(event) {
    await validateCourseEvent(strapi, event);
  },
};

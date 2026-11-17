'use strict';

const localities = require('../../../services/localities');

module.exports = {
  async list(ctx) {
    ctx.body = { data: await localities.listPublic(strapi) };
  },
};

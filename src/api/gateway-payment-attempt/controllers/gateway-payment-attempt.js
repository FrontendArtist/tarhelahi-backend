'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
module.exports = createCoreController('api::gateway-payment-attempt.gateway-payment-attempt', ({ strapi }) => ({
  async claim(ctx) {
    const resNum = String(ctx.request.body?.resNum || '');
    if (!resNum) return ctx.badRequest();
    const result = await strapi.db.query('api::gateway-payment-attempt.gateway-payment-attempt').updateMany({
      where: { resNum, status: 'token_issued' },
      data: { status: 'verifying' },
    });
    ctx.body = { claimed: result.count === 1 };
  },
}));

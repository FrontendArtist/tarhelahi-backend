const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::faq.faq', ({ strapi }) => ({
  async find(ctx) {
    try {
      // فقط فیلدهایی که می‌خوای از DB انتخاب کن
      const faqs = await strapi.entityService.findMany('api::faq.faq', {
        fields: ['No', 'question', 'answer'], // ✅ فقط همین‌ها
        sort: { No: 'asc' },
        filters: ctx.query?.filters || {},
        populate: {}, // 👈 جلوی populate خودکار رو می‌گیره
      });

      // خروجی JSON ساده بدون createdAt, updatedAt, publishedAt
      return faqs;
    } catch (err) {
      strapi.log.error('❌ FAQ find error:', err);
      ctx.response.status = 500;
      return { error: 'Internal Server Error' };
    }
  },
}));

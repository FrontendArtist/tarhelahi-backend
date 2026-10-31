'use strict';

/**
 * notification controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::notification.notification', ({ strapi }) => ({
  async find(ctx) {
    const isApiToken = ctx.state?.auth?.strategy?.name === 'api-token';
    const user = ctx.state?.user;

    if (!isApiToken && !user) {
      return { data: [], meta: { pagination: { page: 1, pageSize: 25, pageCount: 0, total: 0 } } };
    }

    if (!isApiToken && user) {
      const userWithRole = await strapi.entityService.findOne(
        'plugin::users-permissions.user',
        user.id,
        { populate: ['role'] }
      );
      const roleType = userWithRole?.role?.type;
      const isAdmin = roleType === 'admin' || roleType === 'administrator';

      if (!isAdmin || ctx.query?.scope === 'my') {
        ctx.query = {
          ...ctx.query,
          filters: {
            ...ctx.query?.filters,
            users_permissions_user: { id: { $eq: user.id } },
          },
        };
      }
    }

    return await super.find(ctx);
  },

  async update(ctx) {
    const isApiToken = ctx.state?.auth?.strategy?.name === 'api-token';
    const user = ctx.state?.user;

    if (!isApiToken && !user) {
      return ctx.unauthorized('ابتدا وارد حساب کاربری شوید');
    }

    if (!isApiToken && user) {
      const { id } = ctx.params;
      const existing = await strapi.documents('api::notification.notification').findOne({
        documentId: id,
        populate: ['users_permissions_user'],
      });

      if (!existing) {
        return ctx.notFound('اعلان مورد نظر یافت نشد');
      }

      if (existing.users_permissions_user?.id !== user.id) {
        return ctx.forbidden('دسترسی غیرمجاز');
      }

      ctx.request.body = {
        data: {
          isRead: Boolean(ctx.request?.body?.data?.isRead ?? true),
        },
      };
    }

    return await super.update(ctx);
  },
}));

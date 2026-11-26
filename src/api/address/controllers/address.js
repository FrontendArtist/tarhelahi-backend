'use strict';

/**
 * address controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

function isAdminUser(user) {
  const roleType = String(user?.role?.type || user?.role?.name || user?.role || '')
    .trim()
    .toLowerCase();
  return roleType === 'administrator' || roleType === 'admin';
}

function isRegularUser(ctx) {
  return (
    ctx.state?.auth?.strategy?.name !== 'api-token' &&
    Boolean(ctx.state?.user?.id) &&
    !isAdminUser(ctx.state.user)
  );
}

module.exports = createCoreController('api::address.address', () => ({
  async find(ctx) {
    if (isRegularUser(ctx)) {
      const existingFilters =
        ctx.query?.filters && typeof ctx.query.filters === 'object' ? ctx.query.filters : {};
      ctx.query = {
        ...ctx.query,
        filters: {
          ...existingFilters,
          user: { id: { $eq: ctx.state.user.id } },
        },
      };
    }
    return super.find(ctx);
  },

  async create(ctx) {
    if (isRegularUser(ctx)) {
      const bodyData =
        ctx.request.body?.data && typeof ctx.request.body.data === 'object'
          ? ctx.request.body.data
          : {};
      ctx.request.body = {
        ...ctx.request.body,
        data: {
          ...bodyData,
          user: ctx.state.user.id,
        },
      };
    }
    return super.create(ctx);
  },

  async update(ctx) {
    if (isRegularUser(ctx) && ctx.request.body?.data && typeof ctx.request.body.data === 'object') {
      const { user: _ignoredUser, ...safeData } = ctx.request.body.data;
      ctx.request.body = {
        ...ctx.request.body,
        data: safeData,
      };
    }
    return super.update(ctx);
  },
}));

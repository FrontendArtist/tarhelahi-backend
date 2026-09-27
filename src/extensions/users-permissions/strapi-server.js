'use strict';

const byeMoneySyncService = require('../../services/byeMoneySyncService');

module.exports = (plugin) => {
  const originalUpdate = plugin.controllers.user.update;

  plugin.controllers.user.update = async function (ctx) {
    const { id } = ctx.params;
    const requestBody = ctx.request?.body;

    const hasIdentityField = byeMoneySyncService.hasIdentityFieldsInPayload(requestBody);

    let userBefore = null;
    if (hasIdentityField) {
      try {
        userBefore = await strapi.plugin('users-permissions').service('user').fetch(id);
      } catch {
        userBefore = null;
      }
    }

    // 1. Execute original Strapi update controller method
    await originalUpdate.call(this, ctx);

    // 2. After DB save succeeds (status 2xx or default 200), check if any identity fields changed
    if (userBefore && (!ctx.status || (ctx.status >= 200 && ctx.status < 300))) {
      const changed = byeMoneySyncService.hasIdentityFieldsChanged(userBefore, requestBody);
      if (changed) {
        // 3. Fire-and-forget: do NOT await, do NOT block user response
        byeMoneySyncService.syncUser(userBefore).catch((err) => {
          strapi.log.error(
            `[ByeMoneySync] Unhandled error during fire-and-forget sync for user ${userBefore.id}: ${err.message}`
          );
        });
      }
    }
  };

  const originalFind = plugin.controllers.user.find;

  plugin.controllers.user.find = async function (ctx) {
    const query = { ...ctx.query };

    let page = query.page;
    let pageSize = query.pageSize;
    let start = query.start;
    let limit = query.limit;

    if (query.pagination && typeof query.pagination === 'object') {
      if (query.pagination.page !== undefined) page = query.pagination.page;
      if (query.pagination.pageSize !== undefined) pageSize = query.pagination.pageSize;
      if (query.pagination.start !== undefined) start = query.pagination.start;
      if (query.pagination.limit !== undefined) limit = query.pagination.limit;
    }

    if (page !== undefined || pageSize !== undefined) {
      const p = Math.max(1, parseInt(page, 10) || 1);
      const ps = Math.max(1, parseInt(pageSize, 10) || 25);
      query.start = (p - 1) * ps;
      query.limit = ps;
      delete query.page;
      delete query.pageSize;
      if (query.pagination && typeof query.pagination === 'object') {
        delete query.pagination.page;
        delete query.pagination.pageSize;
        if (Object.keys(query.pagination).length === 0) {
          delete query.pagination;
        }
      }
    } else if (start !== undefined || limit !== undefined) {
      if (start !== undefined) query.start = Math.max(0, parseInt(start, 10) || 0);
      if (limit !== undefined) query.limit = Math.max(1, parseInt(limit, 10) || 25);
      if (query.pagination && typeof query.pagination === 'object') {
        delete query.pagination.start;
        delete query.pagination.limit;
        if (Object.keys(query.pagination).length === 0) {
          delete query.pagination;
        }
      }
    }

    ctx.query = query;
    await originalFind.call(this, ctx);
  };

  return plugin;
};

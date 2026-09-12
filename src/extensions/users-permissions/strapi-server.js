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

  return plugin;
};

'use strict';

const { money } = require('../services/gatewayReviewWorkflow');

module.exports = async (ctx) => {
  const authorization = ctx.request?.headers?.authorization || '';
  const user = ctx.state?.user;
  const userIdentifier = user?.documentId || user?.id;

  if (!userIdentifier || !authorization.startsWith('Bearer ')) {
    if (global.strapi?.log?.warn) {
      global.strapi.log.warn(`[has-financial-review-permission] Access denied: missing user (${JSON.stringify(user)}) or invalid Bearer token`);
    }
    return false;
  }

  try {
    const permissions = await money('/api/admin/topups/permissions', { jwt: authorization.slice(7) });
    const hasPermission =
      permissions?.canReviewTopUps === true ||
      (Array.isArray(permissions?.permissions) && permissions.permissions.includes('TopUp.Review'));

    if (!hasPermission && global.strapi?.log?.warn) {
      global.strapi.log.warn(`[has-financial-review-permission] Access denied: permissions received: ${JSON.stringify(permissions)}`);
    }
    return Boolean(hasPermission);
  } catch (err) {
    if (global.strapi?.log?.error) {
      global.strapi.log.error(`[has-financial-review-permission] Error contacting ByeMoney: ${err.message} (status: ${err.status}, code: ${err.code})`);
    }
    return false;
  }
};

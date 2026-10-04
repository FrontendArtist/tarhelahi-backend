'use strict';

const { money } = require('../services/gatewayReviewWorkflow');

module.exports = async (ctx) => {
  const authorization = ctx.request?.headers?.authorization || '';
  if (!ctx.state?.user?.documentId || !authorization.startsWith('Bearer ')) return false;
  try {
    const permissions = await money('/api/admin/topups/permissions', { jwt: authorization.slice(7) });
    return permissions.canReviewTopUps === true;
  } catch (_) { return false; }
};

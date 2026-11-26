'use strict';

const { UnauthorizedError, ForbiddenError } = require('@strapi/utils').errors;

const ADMIN_ROLES = new Set(['administrator', 'admin']);

function getRoleString(user) {
  return String(user?.role?.type || user?.role?.name || user?.role || '')
    .trim()
    .toLowerCase();
}

module.exports = async (policyContext, _config, { strapi } = {}) => {
  const strategyName = policyContext?.state?.auth?.strategy?.name;
  if (strategyName === 'api-token' || strategyName === 'admin') {
    return true;
  }

  let user = policyContext?.state?.user;
  if (!user?.id) {
    throw new UnauthorizedError('احراز هویت برای دسترسی به این مسیر الزامی است.');
  }

  let roleStr = getRoleString(user);
  if (!roleStr && strapi?.db?.query) {
    const dbUser = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: user.id },
      populate: ['role'],
    });
    if (dbUser) {
      roleStr = getRoleString(dbUser);
    }
  }

  if (ADMIN_ROLES.has(roleStr)) {
    return true;
  }

  throw new ForbiddenError('دسترسی به این مسیر فقط برای مدیر مجاز است.');
};

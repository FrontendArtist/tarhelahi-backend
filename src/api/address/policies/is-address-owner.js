'use strict';

function isAdminUser(user) {
  const roleType = String(user?.role?.type || user?.role?.name || user?.role || '')
    .trim()
    .toLowerCase();
  return roleType === 'administrator' || roleType === 'admin';
}

async function findAddressWithUser(strapi, id) {
  const strId = String(id).trim();
  if (!strId) return null;

  if (typeof strapi?.documents === 'function') {
    const byDoc = await strapi
      .documents('api::address.address')
      .findOne({ documentId: strId, populate: ['user'] });
    if (byDoc) return byDoc;
  }

  if (/^\d+$/.test(strId) && strapi?.db?.query) {
    return strapi.db
      .query('api::address.address')
      .findOne({ where: { id: Number(strId) }, populate: ['user'] });
  }

  return null;
}

module.exports = async (policyContext, _config, { strapi }) => {
  if (policyContext.state?.auth?.strategy?.name === 'api-token') {
    return true;
  }

  const user = policyContext.state?.user;
  if (!user?.id) {
    return false;
  }

  if (isAdminUser(user)) {
    return true;
  }

  const id = policyContext.params?.id;
  if (!id) {
    // create و find در کنترلر به کاربر جاری محدود می‌شوند
    return true;
  }

  const address = await findAddressWithUser(strapi, id);
  if (!address) {
    // اجازه می‌دهیم کنترلر پاسخ استاندارد 404 برگرداند
    return true;
  }

  return Boolean(address.user?.id && String(address.user.id) === String(user.id));
};

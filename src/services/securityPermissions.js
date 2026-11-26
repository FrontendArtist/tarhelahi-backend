'use strict';

const RESTRICTED_ACTIONS = [
  'api::order.order.find',
  'api::order.order.findOne',
  'api::order.order.create',
  'api::order.order.update',
  'api::order.order.delete',
  'api::coupon.coupon.find',
  'api::coupon.coupon.findOne',
  'api::coupon.coupon.create',
  'api::coupon.coupon.update',
  'api::coupon.coupon.delete',
];

const NON_ADMIN_ROLE_TYPES = ['public', 'authenticated'];

/**
 * Revokes sensitive order and coupon permissions from Public and Authenticated roles
 * so Strapi's users-permissions DB state stays aligned with route policies.
 */
async function revokeSensitivePublicPermissions(strapi) {
  if (!strapi?.db?.query) {
    return { removed: 0 };
  }

  const roles = await strapi.db.query('plugin::users-permissions.role').findMany({
    where: { type: { $in: NON_ADMIN_ROLE_TYPES } },
    select: ['id', 'type'],
  });

  if (!Array.isArray(roles) || roles.length === 0) {
    return { removed: 0 };
  }

  const roleIds = roles.map((role) => role.id).filter(Boolean);
  if (roleIds.length === 0) {
    return { removed: 0 };
  }

  const stalePermissions = await strapi.db.query('plugin::users-permissions.permission').findMany({
    where: {
      role: { id: { $in: roleIds } },
      action: { $in: RESTRICTED_ACTIONS },
    },
    select: ['id', 'action'],
  });

  if (!Array.isArray(stalePermissions) || stalePermissions.length === 0) {
    return { removed: 0 };
  }

  for (const permission of stalePermissions) {
    await strapi.db.query('plugin::users-permissions.permission').delete({
      where: { id: permission.id },
    });
  }

  strapi.log?.info?.(
    `[SecurityPermissions] Revoked ${stalePermissions.length} sensitive order/coupon permission(s) from public/authenticated roles.`,
  );

  return { removed: stalePermissions.length };
}

module.exports = {
  RESTRICTED_ACTIONS,
  NON_ADMIN_ROLE_TYPES,
  revokeSensitivePublicPermissions,
};

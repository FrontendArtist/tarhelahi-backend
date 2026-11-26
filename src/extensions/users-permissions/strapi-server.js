'use strict';

const byeMoneySyncService = require('../../services/byeMoneySyncService');

const ALLOWED_SELF_UPDATE_FIELDS = new Set(['firstName', 'lastName', 'email']);
const SENSITIVE_USER_FIELDS = new Set([
  'courses',
  'enrolledChapters',
  'enrolledChapterIntegrationIds',
  'role',
  'password',
  'phoneNumber',
  'blocked',
  'confirmed',
  'isMobileVerified',
  'username',
  'provider',
  'resetPasswordToken',
  'confirmationToken',
  'otpCode',
  'otpExpiresAt',
  'otpAttempts',
  'otpLastSentAt',
  'cartData',
  'is_foreigner',
  'orders',
  'address',
  'comments',
  'messages',
  'notifications',
  'items',
]);

function isAdminUser(user) {
  const roleType = String(user?.role?.type || user?.role?.name || user?.role || '')
    .trim()
    .toLowerCase();
  return roleType === 'administrator' || roleType === 'admin';
}

function isPrivilegedRequest(ctx) {
  return (
    ctx?.state?.auth?.strategy?.name === 'api-token' ||
    isAdminUser(ctx?.state?.user)
  );
}

module.exports = (plugin) => {
  const originalUpdate = plugin.controllers.user.update;

  plugin.controllers.user.update = async function (ctx) {
    const { id } = ctx.params;
    let requestBody = ctx.request?.body;

    if (requestBody && Object.prototype.hasOwnProperty.call(requestBody, 'light')) {
      return ctx.badRequest('The "light" field on Users-Permissions is deprecated and blocked.');
    }

    if (!isPrivilegedRequest(ctx)) {
      const currentUserId = ctx.state?.user?.id;
      if (!currentUserId || String(id) !== String(currentUserId)) {
        return ctx.forbidden('شما فقط مجاز به ویرایش پروفایل خودتان هستید.');
      }

      if (requestBody && typeof requestBody === 'object' && !Array.isArray(requestBody)) {
        const keys = Object.keys(requestBody);
        for (const key of keys) {
          if (SENSITIVE_USER_FIELDS.has(key) || !ALLOWED_SELF_UPDATE_FIELDS.has(key)) {
            return ctx.forbidden('ویرایش فیلدهای حساس کاربر مجاز نیست.');
          }
        }

        const sanitizedBody = {};
        for (const key of keys) {
          if (ALLOWED_SELF_UPDATE_FIELDS.has(key)) {
            sanitizedBody[key] = requestBody[key];
          }
        }
        ctx.request.body = sanitizedBody;
        requestBody = sanitizedBody;
      }
    }

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

  if (plugin.controllers.user?.create) {
    const originalCreate = plugin.controllers.user.create;
    plugin.controllers.user.create = async function (ctx) {
      const requestBody = ctx.request?.body;
      if (requestBody && Object.prototype.hasOwnProperty.call(requestBody, 'light')) {
        return ctx.badRequest('The "light" field on Users-Permissions is deprecated and blocked.');
      }
      if (!isPrivilegedRequest(ctx)) {
        return ctx.forbidden('ایجاد کاربر فقط برای مدیر مجاز است.');
      }
      return originalCreate.call(this, ctx);
    };
  }

  if (plugin.controllers.user?.destroy) {
    const originalDestroy = plugin.controllers.user.destroy;
    plugin.controllers.user.destroy = async function (ctx) {
      if (!isPrivilegedRequest(ctx)) {
        return ctx.forbidden('حذف کاربر فقط برای مدیر مجاز است.');
      }
      return originalDestroy.call(this, ctx);
    };
  }

  if (plugin.controllers.user?.count) {
    const originalCount = plugin.controllers.user.count;
    plugin.controllers.user.count = async function (ctx) {
      if (!isPrivilegedRequest(ctx)) {
        return ctx.forbidden('دسترسی به شمارش کاربران فقط برای مدیر مجاز است.');
      }
      return originalCount.call(this, ctx);
    };
  }

  if (plugin.controllers.auth?.register) {
    const originalRegister = plugin.controllers.auth.register;
    plugin.controllers.auth.register = async function (ctx) {
      const requestBody = ctx.request?.body;
      if (requestBody && Object.prototype.hasOwnProperty.call(requestBody, 'light')) {
        return ctx.badRequest('The "light" field on Users-Permissions is deprecated and blocked.');
      }
      return originalRegister.call(this, ctx);
    };
  }

  if (plugin.routes?.['content-api']?.routes) {
    const blockedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
    for (const method of blockedMethods) {
      plugin.routes['content-api'].routes.unshift(
        {
          method,
          path: '/users/light',
          handler: (ctx) => ctx.badRequest('The "light" route on Users-Permissions is deprecated and blocked.'),
          config: { auth: false },
        },
        {
          method,
          path: '/users/:id/light',
          handler: (ctx) => ctx.badRequest('The "light" route on Users-Permissions is deprecated and blocked.'),
          config: { auth: false },
        }
      );
    }
  }

  const originalFind = plugin.controllers.user.find;

  plugin.controllers.user.find = async function (ctx) {
    if (!isPrivilegedRequest(ctx)) {
      return ctx.forbidden('دسترسی به فهرست کاربران فقط برای مدیر مجاز است.');
    }

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

  async function attachEnrolledChapterIntegrationIds(user) {
    if (!user) return;
    const stored = Array.isArray(user.enrolledChapterIntegrationIds)
      ? user.enrolledChapterIntegrationIds.map((id) => String(id).trim().toLowerCase()).filter(Boolean)
      : [];
    let calculated = [];
    if (Array.isArray(user.enrolledChapters) && user.enrolledChapters.length > 0) {
      const chapterIds = user.enrolledChapters.map(Number).filter(Boolean);
      if (chapterIds.length > 0) {
        try {
          const rows = await strapi.db.connection('components_course_parts_chapters')
            .whereIn('id', chapterIds)
            .whereNotNull('integration_id')
            .select('id', 'integration_id');
          calculated = rows.map((r) => String(r.integration_id).trim().toLowerCase()).filter(Boolean);
        } catch {
          calculated = [];
        }
      }
    }
    user.enrolledChapterIntegrationIds = [...new Set([...stored, ...calculated])];
  }

  if (plugin.controllers.user?.findOne) {
    const originalFindOne = plugin.controllers.user.findOne;
    plugin.controllers.user.findOne = async function (ctx) {
      if (!isPrivilegedRequest(ctx)) {
        const currentUserId = ctx.state?.user?.id;
        if (!currentUserId || String(ctx.params?.id) !== String(currentUserId)) {
          return ctx.forbidden('دسترسی به اطلاعات کاربر دیگر مجاز نیست.');
        }
      }
      await originalFindOne.call(this, ctx);
      await attachEnrolledChapterIntegrationIds(ctx.body);
    };
  }

  if (plugin.controllers.user?.me) {
    const originalMe = plugin.controllers.user.me;
    plugin.controllers.user.me = async function (ctx) {
      await originalMe.call(this, ctx);
      await attachEnrolledChapterIntegrationIds(ctx.body);
    };
  }

  return plugin;
};

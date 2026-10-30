'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// Mock @strapi/strapi createCoreService factory
const Module = require('node:module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@strapi/strapi') {
    return {
      factories: {
        createCoreService: (uid, fn) => ({ strapi }) => fn({ strapi }),
      },
    };
  }
  return origLoad.apply(this, arguments);
};

const createNotificationService = require('../src/api/notification/services/notification');

function createMockStrapi({ orders = [], messages = [], contactMessages = [], users = [] } = {}) {
  const notifications = [];
  let nextId = 1;

  const strapi = {
    db: {
      query: (uid) => {
        if (uid === 'api::notification.notification') {
          return {
            findMany: async ({ where = {} }) => {
              return notifications
                .filter((n) => {
                  if (
                    where.users_permissions_user?.id &&
                    n.users_permissions_user !== where.users_permissions_user.id
                  ) {
                    return false;
                  }
                  if (where.eventKey !== undefined && n.eventKey !== where.eventKey) {
                    return false;
                  }
                  if (where.rawId !== undefined && n.rawId !== where.rawId) {
                    return false;
                  }
                  if (where.isRead !== undefined && n.isRead !== where.isRead) {
                    return false;
                  }
                  return true;
                })
                .sort((a, b) => b.id - a.id);
            },
            updateMany: async ({ where = {}, data = {} }) => {
              const ids = where.id?.$in || [];
              let count = 0;
              for (const n of notifications) {
                if (ids.includes(n.id)) {
                  Object.assign(n, data);
                  count++;
                }
              }
              return { count };
            },
            create: async ({ data }) => {
              const record = { id: nextId++, documentId: `notif-${nextId}`, ...data };
              notifications.push(record);
              return record;
            },
          };
        }
        if (uid === 'api::order.order') {
          return {
            findOne: async ({ where }) => orders.find((o) => o.id === where.id) || null,
            findMany: async ({ where }) =>
              orders.filter((o) => String(o.documentId) === String(where.document_id)),
          };
        }
        if (uid === 'api::message.message') {
          return {
            findOne: async ({ where }) => messages.find((m) => m.id === where.id) || null,
            findMany: async ({ where }) =>
              messages.filter((m) => String(m.documentId) === String(where.document_id)),
          };
        }
        if (uid === 'api::contact-message.contact-message') {
          return {
            findOne: async ({ where }) => contactMessages.find((m) => m.id === where.id) || null,
            findMany: async ({ where }) =>
              contactMessages.filter((m) => String(m.documentId) === String(where.document_id)),
          };
        }
        if (uid === 'plugin::users-permissions.user') {
          return {
            findOne: async ({ where }) => {
              const orConds = where.$or || [];
              return (
                users.find((u) =>
                  orConds.some(
                    (c) =>
                      (c.phoneNumber && u.phoneNumber === c.phoneNumber) ||
                      (c.email && u.email === c.email)
                  )
                ) || null
              );
            },
          };
        }
        return {};
      },
    },
  };

  return {
    strapi,
    notifications,
    service: createNotificationService({ strapi }),
  };
}

test('تغییر وضعیت سفارش از در حال بررسی به تایید شده، اعلان قبلی را خوانده‌شده می‌کند و اعلان تایید می‌سازد', async () => {
  const order = {
    id: 101,
    documentId: 'order-doc-101',
    user: { id: 5 },
    paymentMethod: 'card_to_card',
    orderStatus: 'pending',
    paymentStatus: 'pending_verification',
    items: [{ title: 'دوره جامع' }],
  };

  const { notifications, service } = createMockStrapi({ orders: [order] });

  await service.syncOrderNotification('order-doc-101');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'pending_verification');
  assert.equal(notifications[0].isRead, false);

  // ادمین سفارش را تایید می‌کند
  order.orderStatus = 'paid';
  order.paymentStatus = 'paid';
  await service.syncOrderNotification('order-doc-101');

  assert.equal(notifications.length, 2);
  assert.equal(notifications[0].isRead, true); // اعلان قبلی خودکار خوانده شد
  assert.equal(notifications[1].type, 'confirmed');
  assert.equal(notifications[1].isRead, false);
  assert.match(notifications[1].notifMessage, /دوره جامع/);
});

test('لغو خودکار سبد خرید اعلان اسپم تولید نمی‌کند', async () => {
  const order = {
    id: 102,
    documentId: 'order-doc-102',
    user: { id: 5 },
    paymentMethod: 'online',
    orderStatus: 'canceled',
    paymentStatus: 'pending_payment',
    rejectionReason: 'جایگزین‌شده با سفارش جدید',
    items: [{ title: 'دوره دوم' }],
  };

  const { notifications, service } = createMockStrapi({ orders: [order] });
  await service.syncOrderNotification('order-doc-102');
  assert.equal(notifications.length, 0);
});

test('پاسخ استاد اعلان می‌سازد اما ارسال پیام توسط خود کاربر اعلان نمی‌سازد', async () => {
  const msg = {
    id: 50,
    documentId: 'msg-doc-50',
    user: { id: 9 },
    subject: 'سوال درباره درس اول',
    messageType: 'instructor',
    status: 'answered',
    replies: [
      {
        body: 'پاسخ استاد',
        sender: 'instructor',
        isAdmin: true,
        createdAt: '2026-10-30T10:00:00.000Z',
      },
    ],
  };

  const { notifications, service } = createMockStrapi({ messages: [msg] });

  await service.syncMessageNotification('msg-doc-50', 'api::message.message');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'mentor_reply');
  assert.equal(notifications[0].isRead, false);

  // کاربر پاسخ جدیدی ارسال می‌کند -> نباید اعلان جدیدی برای خودش ساخته شود
  msg.replies.push({
    body: 'ممنون استاد',
    sender: 'user',
    isAdmin: false,
    createdAt: '2026-10-30T10:05:00.000Z',
  });
  msg.status = 'open';

  await service.syncMessageNotification('msg-doc-50', 'api::message.message');
  assert.equal(notifications.length, 1);
});

test('پاسخ پشتیبانی در contact-message اعلان support_reply می‌سازد', async () => {
  const contactMsg = {
    id: 60,
    documentId: 'contact-doc-60',
    contactInfo: '09120000000',
    subject: 'پیگیری سفارش',
    status: 'closed',
    replies: [
      {
        body: 'بررسی شد',
        isAdmin: true,
        createdAt: '2026-10-30T11:00:00.000Z',
      },
    ],
  };

  const { notifications, service } = createMockStrapi({
    contactMessages: [contactMsg],
    users: [{ id: 12, phoneNumber: '09120000000' }],
  });

  await service.syncMessageNotification('contact-doc-60', 'api::contact-message.contact-message');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'support_reply');
  assert.equal(notifications[0].users_permissions_user, 12);
});


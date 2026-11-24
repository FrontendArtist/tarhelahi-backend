'use strict';

jest.mock('../../src/services/smsService', () => ({
  sendCourseTelegramLinkSms: jest.fn(async () => ({ success: true })),
}));

jest.mock('../../src/services/physicalStockMiddleware', () => ({
  managedOrder: { getStore: () => false },
}));

const lifecycles = require('../../src/api/order/content-types/order/lifecycles');

describe('Order Lifecycle Concurrency & Locking (M10)', () => {
  const originalStrapi = global.strapi;

  afterEach(() => {
    global.strapi = originalStrapi;
  });

  test('uses { connect: [userId] } for course relation and FOR UPDATE transaction for user JSON chapter fields', async () => {
    const courseUpdates = [];
    const userUpdates = [];
    let forUpdateCalled = false;
    let transactionCalled = false;

    const order = {
      id: 101,
      orderStatus: 'paid',
      paymentStatus: 'paid',
      user: { id: 77 },
      items: [
        { __component: 'order.course-order-item', courseId: 12 },
        { __component: 'order.course-order-item', courseId: 12, chapterId: 302, chapterIntegrationId: 'UUID-302' },
      ],
    };

    const userRow = {
      id: 77,
      enrolledChapters: [301],
      enrolledChapterIntegrationIds: ['uuid-301'],
    };

    const courseRow = {
      id: 12,
      title: 'Test Course',
      slug: 'test-course',
      chapters: [{ id: 301, integrationId: 'uuid-301' }],
    };

    const trxBuilder = {
      where: jest.fn(() => trxBuilder),
      forUpdate: jest.fn(() => {
        forUpdateCalled = true;
        return trxBuilder;
      }),
      select: jest.fn(async () => [{ id: 77 }]),
    };
    const trx = jest.fn(() => trxBuilder);

    global.strapi = {
      service: jest.fn(() => null),
      db: {
        metadata: {
          get: jest.fn(() => ({ tableName: 'up_users' })),
        },
        transaction: jest.fn(async (cb) => {
          transactionCalled = true;
          return cb({ trx });
        }),
        query: jest.fn((uid) => {
          if (uid === 'api::order.order') {
            return {
              findOne: jest.fn(async () => order),
              findMany: jest.fn(async () => [order]),
              update: jest.fn(async () => ({})),
            };
          }
          if (uid === 'api::course.course') {
            return {
              findOne: jest.fn(async () => courseRow),
              findMany: jest.fn(async () => [courseRow]),
              update: jest.fn(async (args) => {
                courseUpdates.push(args);
                return {};
              }),
            };
          }
          if (uid === 'plugin::users-permissions.user') {
            return {
              findOne: jest.fn(async () => userRow),
              update: jest.fn(async (args) => {
                userUpdates.push(args);
                return {};
              }),
            };
          }
          return {};
        }),
      },
    };

    await lifecycles.afterUpdate({ result: { id: 101 } });

    expect(courseUpdates).toHaveLength(1);
    expect(courseUpdates[0].data.users_permissions_users).toEqual({ connect: [77] });

    expect(transactionCalled).toBe(true);
    expect(forUpdateCalled).toBe(true);
    expect(userUpdates).toHaveLength(1);
    expect(userUpdates[0].data.enrolledChapters).toEqual([301, 302]);
    expect(userUpdates[0].data.enrolledChapterIntegrationIds).toEqual(['uuid-301', 'uuid-302']);
  });
});

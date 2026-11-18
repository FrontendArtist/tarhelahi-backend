'use strict';

const { documentMiddleware } = require('../../src/services/chapterDeletionGuard');

const UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function harness({ order = null, logs = [] } = {}) {
  const strapi = {
    db: {
      query(uid) {
        if (uid === 'api::course.course') {
          return {
            findOne: async () => ({
              chapters: [{ id: 7, integrationId: UUID, title: 'فصل خریده‌شده' }],
            }),
          };
        }
        return {
          findOne: async ({ where }) => logs.find((log) => {
            if (where.itemType === 'course_chapter') {
              return String(log.chapterExternalId).toLowerCase() === where.chapterExternalId.$eqi
                && log.status === where.status;
            }
            return log.courseId === where.courseId && log.status === where.status;
          }) || null,
        };
      },
      connection: () => ({
        where(apply) {
          apply({ whereRaw() {}, orWhere() {} });
          return { first: async () => order };
        },
      }),
    },
  };
  return documentMiddleware(strapi);
}

function event() {
  return {
    uid: 'api::course.course',
    action: 'update',
    params: { documentId: 'course-1', data: { chapters: [] } },
  };
}

test('حذف فصل بدون خرید مجاز است', async () => {
  const next = jest.fn();
  await harness()(event(), next);
  expect(next).toHaveBeenCalled();
});

test('لاگ خرید فصل در کیف پول حذف فصل را رد می‌کند', async () => {
  const next = jest.fn();
  await expect(harness({
    logs: [{ status: 'processed', itemType: 'course_chapter', chapterExternalId: UUID.toUpperCase() }],
  })(event(), next)).rejects.toThrow('امکان حذف آن وجود ندارد');
  expect(next).not.toHaveBeenCalled();
});

test('لاگ خرید کل دوره در کیف پول حذف فصل را رد می‌کند', async () => {
  await expect(harness({
    logs: [{ status: 'processed', itemType: 'course', courseId: 'course-1' }],
  })(event(), nextNoop)).rejects.toThrow('امکان حذف آن وجود ندارد');
});

async function nextNoop() {}

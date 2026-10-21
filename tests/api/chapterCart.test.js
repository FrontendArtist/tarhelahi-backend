'use strict';

const { randomUUID } = require('node:crypto');
const factory = require('../../src/api/coupon/services/coupon');
const service = require('../../src/services/byeMoneyCartService');
const { confirmPurchase } = require('../../src/services/byeMoneyPurchaseService');
const { normalizeChapters, validateCourseEvent } = require('../../src/services/chapterIdentity');
const controller = require('../../src/api/integration/controllers/integration');

function fixture() {
  const first = randomUUID();
  const second = randomUUID();
  const parent = {
    id: 10,
    documentId: 'parent',
    title: 'دورهٔ فصلی',
    slug: 'parent',
    isChaptered: true,
    publishedAt: new Date(),
    price: 999,
    discountPercent: 90,
    chapters: [
      { id: 21, integrationId: first, title: 'فصل اول', price: 105 },
      { id: 22, integrationId: second, title: 'فصل دوم', price: 105 },
    ],
  };
  const draft = {
    ...parent,
    id: 11,
    publishedAt: null,
    chapters: parent.chapters.map((chapter) => ({ ...chapter, id: chapter.id + 100 })),
  };
  const full = {
    id: 21,
    documentId: 'full',
    price: 105,
    title: 'دورهٔ کامل',
    publishedAt: new Date(),
  };
  const buyer = { id: 1, documentId: 'buyer', confirmed: true, courses: [], enrolledChapters: [] };
  const logs = [];
  const carts = [];
  const writes = jest.fn();
  const coupon = {
    documentId: 'coupon',
    code: 'OFF',
    isActive: true,
    discountType: 'percentage',
    discountValue: 10,
    courses: [parent],
    appliesToAllCourses: false,
  };
  const findCourse = (where) => {
    if (where.chapters) {
      return [parent, draft].find(
        (course) =>
          (!where.documentId || where.documentId === course.documentId) &&
          (!where.publishedAt || course.publishedAt) &&
          course.chapters.some((chapter) => chapter.integrationId === where.chapters.integrationId),
      );
    }
    return [parent, full].find((course) => course.documentId === where.documentId);
  };
  const repositories = {
    'api::course.course': {
      findOne: jest.fn(async ({ where }) => findCourse(where)),
      findMany: jest.fn(async () => [parent, draft]),
      update: writes,
    },
    'plugin::users-permissions.user': {
      findOne: jest.fn(async ({ where }) => (where.documentId === buyer.documentId ? buyer : null)),
      update: jest.fn(async ({ data }) => Object.assign(buyer, data)),
    },
    'api::byemoney-purchase-log.byemoney-purchase-log': {
      findOne: jest.fn(async ({ where }) =>
        logs.find((log) => log.purchaseId === where.purchaseId),
      ),
      create: jest.fn(async ({ data }) => logs.push(data)),
    },
    'api::byemoney-cart.byemoney-cart': {
      findOne: jest.fn(async ({ where }) => carts.find((cart) => cart.cartId === where.cartId)),
      create: jest.fn(async ({ data }) => carts.push({ id: carts.length + 1, ...data })),
      update: jest.fn(async ({ where, data }) =>
        Object.assign(
          carts.find((cart) => cart.id === where.id),
          data,
        ),
      ),
    },
  };
  const strapi = {
    contentType: () => ({}),
    documents: (uid) => ({
      findOne: async ({ documentId }) =>
        [parent, full].find((course) => course.documentId === documentId),
      findMany: async () => (uid === 'api::coupon.coupon' ? [coupon] : []),
    }),
    db: {
      query: (uid) => repositories[uid],
      transaction: async (callback) => callback({ trx: { raw: jest.fn() } }),
    },
  };
  const coupons = factory({ strapi });
  strapi.service = () => coupons;
  const input = {
    cartId: randomUUID(),
    buyerExternalUserId: 'buyer',
    externalCourseIds: [first, second],
  };
  return {
    strapi,
    parent,
    draft,
    full,
    first,
    second,
    buyer,
    logs,
    carts,
    writes,
    coupon,
    input,
    repositories,
  };
}

test('قیمت فصل فقط از فصل و شمول کوپن از والد می‌آید؛ برخورد شناسهٔ عددی اثر ندارد', async () => {
  const f = fixture();
  const quote = await service.preview(f.strapi, {
    ...f.input,
    externalCourseIds: [f.first, f.second, 'full'],
    couponCode: 'OFF',
  });
  expect(quote.originalTotalInNoor).toBe(315);
  expect(quote.itemDiscountInNoor).toBe(0);
  expect(quote.couponDiscountInNoor).toBe(20);
  expect(quote.priceInNoor).toBe(295);
  expect(quote.courses.filter((item) => item.type === 'course_chapter')).toHaveLength(2);
  expect(quote.courses.find((item) => item.externalCourseId === 'full').couponDiscountInNoor).toBe(
    0,
  );
  expect(quote.courses.find((item) => item.externalCourseId === f.first).parentExternalId).toBe(
    'parent',
  );
  expect(f.carts).toHaveLength(0);
});

test('فصل رایگان و کوپن صددرصد با مبلغ صفر قابل پیش‌نمایش هستند', async () => {
  const f = fixture();
  f.parent.chapters[0].price = 0;
  f.coupon.appliesToAllCourses = true;
  f.coupon.discountValue = 100;
  const preview = await service.preview(f.strapi, { ...f.input, couponCode: 'OFF' });
  expect(preview.originalTotalInNoor).toBe(105);
  expect(preview.couponDiscountInNoor).toBe(105);
  expect(preview.priceInNoor).toBe(0);
  expect(f.carts).toHaveLength(0);
});

test.each([null, '', -1, 1.5])('قیمت نامعتبر فصل رایگان فرض نمی‌شود: %s', async price => {
  const f = fixture();
  f.parent.chapters[0].price = price;
  await expect(service.prepare(f.strapi, f.input)).rejects.toMatchObject({ status: 400 });
  expect(f.carts).toHaveLength(0);
});

test('prepare و پیش‌نمایش فصل محاسبهٔ مشترک و ترتیب یکسان دارند', async () => {
  const f = fixture();
  const preview = await service.preview(f.strapi, f.input);
  const snapshot = await service.prepare(f.strapi, f.input);
  expect(snapshot.items).toEqual(preview.courses);
  expect(await service.prepare(f.strapi, f.input)).toEqual(snapshot);
});

test.each(['preview', 'prepare'])('خرید کل دورهٔ فصلی در %s رد می‌شود', async (action) => {
  const f = fixture();
  await expect(
    service[action](f.strapi, { ...f.input, externalCourseIds: ['parent'] }),
  ).rejects.toMatchObject({ code: 'CART_UNAVAILABLE', status: 409 });
  expect(f.carts).toHaveLength(0);
});

test.each(['course', 'published', 'draft'])(
  'مالکیت قدیمی %s خرید فصل را رد می‌کند',
  async (ownership) => {
    const f = fixture();
    if (ownership === 'course') {
      f.buyer.courses = [f.parent];
    } else {
      f.buyer.enrolledChapters = [String(ownership === 'draft' ? 121 : 21)];
    }
    await expect(service.prepare(f.strapi, f.input)).rejects.toMatchObject({
      code: 'CART_UNAVAILABLE',
    });
    expect(f.carts).toHaveLength(0);
  },
);

test('check مالکیت تازه و تغییر نوع فروش والد را بررسی می‌کند', async () => {
  const f = fixture();
  await service.prepare(f.strapi, f.input);
  f.buyer.enrolledChapters = [121];
  await expect(service.transition(f.strapi, f.input, 'check')).rejects.toMatchObject({
    code: 'CART_UNAVAILABLE',
  });
  f.buyer.enrolledChapters = [];
  f.parent.isChaptered = false;
  await expect(service.transition(f.strapi, f.input, 'check')).rejects.toMatchObject({
    code: 'CART_UNAVAILABLE',
  });
});

test('commit فقط همان فصل‌ها را اعطا می‌کند و تکرار آن بی‌اثر است', async () => {
  const f = fixture();
  await service.prepare(f.strapi, f.input);
  const request = { ...f.input, purchaseIds: [randomUUID(), randomUUID()] };
  await service.transition(f.strapi, request, 'commit');
  await service.transition(f.strapi, request, 'commit');
  expect(f.buyer.enrolledChapters.sort()).toEqual([21, 22]);
  expect(f.buyer.courses).toEqual([]);
  expect(f.writes).not.toHaveBeenCalled();
  expect(f.logs).toHaveLength(2);
  expect(f.logs[0]).toMatchObject({ itemType: 'course_chapter', parentExternalId: 'parent' });
});

test('وبهوک نوع فصل را می‌خواند و alias شناسهٔ والد را به اعطای دوره تبدیل نمی‌کند', async () => {
  const f = fixture();
  const payload = {
    purchaseId: randomUUID(),
    buyerExternalUserId: 'buyer',
    courseId: 'parent',
    item: { type: 'CourseChapter', externalId: f.first, parentExternalId: 'parent' },
  };
  expect((await confirmPurchase(payload, { strapiInstance: f.strapi })).response.status).toBe(
    'granted',
  );
  expect((await confirmPurchase(payload, { strapiInstance: f.strapi })).response.status).toBe(
    'already_granted',
  );
  expect(f.buyer.enrolledChapters).toEqual([21]);
  expect(f.buyer.courses).toEqual([]);
  expect(f.writes).not.toHaveBeenCalled();
  payload.item.externalId = f.second;
  expect((await confirmPurchase(payload, { strapiInstance: f.strapi })).httpStatus).toBe(409);
});

test('وبهوک فصل با والد نادرست یا نوع نامعتبر هیچ دسترسی نمی‌دهد', async () => {
  const f = fixture();
  const payload = {
    purchaseId: randomUUID(),
    buyerExternalUserId: 'buyer',
    courseId: 'parent',
    item: { type: 'course_chapter', externalId: f.first, parentExternalId: 'wrong' },
  };
  expect((await confirmPurchase(payload, { strapiInstance: f.strapi })).httpStatus).toBe(404);
  payload.item.type = 'unknown';
  expect((await confirmPurchase(payload, { strapiInstance: f.strapi })).httpStatus).toBe(400);
  expect(f.buyer.enrolledChapters).toEqual([]);
});

test('ساخت شناسهٔ خالی، حفظ شناسهٔ موجود، رد نامعتبر/تکراری و بازتولید کپی', () => {
  const id = randomUUID();
  expect(normalizeChapters([{ id: 1 }], [{ id: 1, integrationId: id }])[0].integrationId).toBe(id);
  expect(normalizeChapters([{}])[0].integrationId).toMatch(/^[0-9a-f-]{36}$/);
  expect(() => normalizeChapters([{ integrationId: 'bad' }])).toThrow();
  expect(() => normalizeChapters([{ integrationId: id }, { integrationId: id }])).toThrow();
  expect(normalizeChapters([{ integrationId: id }], [], true)[0].integrationId).not.toBe(id);
});

test('lifecycle شناسهٔ متعلق به والد دیگر را رد می‌کند', async () => {
  const id = randomUUID();
  const strapi = { db: { query: () => ({ findMany: async () => [{ documentId: 'other' }] }) } };
  await expect(
    validateCourseEvent(strapi, {
      params: { data: { documentId: 'new', chapters: [{ integrationId: id }] } },
    }),
  ).rejects.toThrow('دورهٔ دیگری');
});

test('خطای فروش کل دورهٔ فصلی با کد CART_UNAVAILABLE از کنترلر برمی‌گردد', async () => {
  const f = fixture();
  global.strapi = f.strapi;
  try {
    const ctx = { params: {}, request: { body: { ...f.input, externalCourseIds: ['parent'] } } };
    await controller.prepareCart(ctx);
    expect(ctx.body.code).toBe('CART_UNAVAILABLE');
    expect(ctx.status).toBe(409);
  } finally {
    delete global.strapi;
  }
});

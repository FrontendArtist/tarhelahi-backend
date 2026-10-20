'use strict';
const factory = require('../../src/api/coupon/services/coupon');
const service = require('../../src/services/byeMoneyCartService');
const controller = require('../../src/api/integration/controllers/integration');

function fixture(overrides = {}) {
  const coupon = { documentId: 'coupon', code: 'ALL10', isActive: true, discountType: 'percentage',
    discountValue: 10, appliesToAllCourses: true, ...overrides };
  const courses = [{ id: 1, documentId: 'one', title: 'اول', price: 105 },
    { id: 2, documentId: 'two', title: 'دوم', price: 105 }];
  const writes = jest.fn(() => { throw new Error('پیش‌نمایش نباید داده‌ای بنویسد.'); });
  const strapi = {
    contentType: () => ({}),
    documents: uid => ({
      findOne: async ({ documentId }) => courses.find(course => course.documentId === documentId),
      findMany: async () => uid === 'api::coupon.coupon' ? [coupon] : courses,
    }),
    db: { transaction: writes, query: uid => {
      if (uid !== 'plugin::users-permissions.user') throw new Error('پیش‌نمایش نباید جدول رزرو را بخواند.');
      return { findOne: async () => ({ documentId: 'buyer', confirmed: true, blocked: false, courses: [] }), create: writes, update: writes };
    } },
  };
  const coupons = factory({ strapi });
  coupons.consumeCoupon = writes;
  strapi.service = () => coupons;
  return { strapi, writes, courses };
}
const input = { buyerExternalUserId: 'buyer', externalCourseIds: ['two', 'one'], couponCode: 'all10' };

test('پیش‌نمایش قیمت معتبر و تخصیص ۲۱ نور کوپن را بدون رزرو برمی‌گرداند', async () => {
  const { strapi, writes } = fixture();
  for (let i = 0; i < 2; i++) {
    const data = await service.preview(strapi, input);
    expect(data).toMatchObject({ couponCode: 'ALL10', originalTotalInNoor: 210, couponDiscountInNoor: 21, priceInNoor: 189 });
    expect(data.courses.reduce((sum, row) => sum + row.couponDiscountInNoor, 0)).toBe(21);
    expect(data.cartId).toBeUndefined();
  }
  expect(writes).not.toHaveBeenCalled();
});

test('تخفیف دوره پیش از کوپن عمومی محاسبه می‌شود و قیمت مرورگر نادیده گرفته می‌شود', async () => {
  const { strapi, courses } = fixture();
  courses[0].discountPercent = 10;
  const data = await service.preview(strapi, { ...input, priceInNoor: 1, items: [{ price: 1 }] });
  expect(data.itemDiscountInNoor).toBe(10);
  expect(data.couponDiscountInNoor).toBe(20);
  expect(data.priceInNoor).toBe(180);
});

test('کوپن صددرصد پیش‌نمایش صفر دارد و مصرف نمی‌شود', async () => {
  const { strapi, writes } = fixture({ discountValue: 100 });
  expect((await service.preview(strapi, input)).priceInNoor).toBe(0);
  expect(writes).not.toHaveBeenCalled();
});

test.each([false, true])('قیمت بر اساس هویت ذخیره‌شدهٔ خریدار تعیین می‌شود: %s', async isForeign => {
  const { strapi, courses } = fixture();
  courses[0].internationalPrice = 801;
  courses[0].discountPercent = 10;
  strapi.db.query = () => ({
    findOne: async () => ({ confirmed: true, courses: [], is_foreigner: isForeign }),
  });

  const data = await service.preview(strapi, {
    buyerExternalUserId: 'buyer', externalCourseIds: ['one'], isForeign: !isForeign,
  });

  expect(data.originalTotalInNoor).toBe(isForeign ? 801 : 105);
  expect(data.itemDiscountInNoor).toBe(isForeign ? 0 : 10);
  expect(data.priceInNoor).toBe(isForeign ? 801 : 95);
});

test('کوپن عمومی روی قیمت بین‌المللی معتبر و با حفظ جمع اعمال می‌شود', async () => {
  const { strapi, courses } = fixture();
  courses[0].internationalPrice = 801;
  strapi.db.query = () => ({
    findOne: async () => ({ confirmed: true, courses: [], is_foreigner: true }),
  });
  const data = await service.preview(strapi, input);
  expect(data.originalTotalInNoor).toBe(906);
  expect(data.couponDiscountInNoor).toBe(90);
  expect(data.priceInNoor).toBe(816);
});

test.each([[], ['one', 'one'], ['missing'], [''], Array(101).fill('one')].map(ids => [ids]))('اقلام نامعتبر رد می‌شوند: %j', async ids => {
  const { strapi, writes } = fixture();
  await expect(service.preview(strapi, { ...input, externalCourseIds: ids })).rejects.toMatchObject({ status: 400 });
  expect(writes).not.toHaveBeenCalled();
});

test('ظرفیت تکمیل‌شده حتی در پیش‌نمایش تخفیف معتبر نیست', async () => {
  const { strapi } = fixture({ maxUsage: 1, usedCount: 1 });
  await expect(service.preview(strapi, input)).rejects.toMatchObject({ status: 400 });
});

test('دورهٔ تحت مالکیت خریدار رد می‌شود', async () => {
  const { strapi } = fixture();
  strapi.db.query = () => ({ findOne: async () => ({ confirmed: true, courses: [{ documentId: 'one' }] }) });
  await expect(service.preview(strapi, input)).rejects.toMatchObject({ status: 409 });
});

test('هویت خریدار از claim معتبر خوانده می‌شود و بدنه نمی‌تواند آن را عوض کند', async () => {
  const { strapi } = fixture();
  strapi.plugin = () => ({ service: () => ({ getToken: async () => ({ documentId: 'buyer' }) }) });
  global.strapi = strapi;
  const ctx = { state: { user: { documentId: 'buyer' } }, set: jest.fn(), request: { body: { ...input, buyerExternalUserId: 'attacker' } } };
  await controller.previewCart(ctx);
  expect(ctx.body.priceInNoor).toBe(189);
  strapi.plugin = () => ({ service: () => ({ getToken: async () => ({ documentId: 'attacker' }) }) });
  await controller.previewCart(ctx);
  expect(ctx.status).toBe(401);
  delete global.strapi;
});

test('مسیر پیش‌نمایش هویت کاربری می‌خواهد و توکن سرویس یا claim ناقص را نمی‌پذیرد', async () => {
  const { strapi } = fixture();
  const getToken = jest.fn().mockResolvedValue({ id: 7 });
  strapi.plugin = () => ({ service: () => ({ getToken }) });
  global.strapi = strapi;
  const route = require('../../src/api/integration/routes/integration').routes.find(row => row.path === '/course-carts/preview');
  strapi.controller = () => controller;
  const ctx = { state: {}, set: jest.fn(), request: { body: input } };
  await route.handler(ctx);
  expect(ctx.status).toBe(401);
  expect(getToken).not.toHaveBeenCalled();
  ctx.state.user = { documentId: 'buyer' };
  await route.handler(ctx);
  expect(ctx.status).toBe(401);
  getToken.mockRejectedValueOnce(new Error('invalid token'));
  await route.handler(ctx);
  expect(ctx.status).toBe(401);
  delete global.strapi;
});

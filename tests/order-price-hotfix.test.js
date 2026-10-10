'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { priceCart, createCheckout } = require('../src/api/order/services/checkout-pricing');
const couponFactory = require('../src/api/coupon/services/coupon');
const controllerFactory = require('../src/api/order/controllers/order');

function fixture(overrides = {}) {
  const course = { id: 7, documentId: 'course-seven', title: 'دوره', slug: 'course', price: 109,
    discountPercent: 10, chapters: [{ id: 22, title: 'فصل', price: 40 }], ...overrides };
  const product = { id: 8, documentId: 'product-eight', title: 'کالا', slug: 'product', price: 200 };
  const strapi = {
    contentType: () => ({}),
    documents: uid => ({ findOne: async ({ documentId, status }) => {
      assert.equal(status, 'published');
      const record = uid === 'api::course.course' ? course : product;
      return documentId === record.documentId ? record : null;
    }, findMany: async () => [strapi.coupon] }),
    db: { transaction: async fn => fn({}), query: uid => ({ findOne: async ({ where }) => {
      const record = uid === 'api::course.course' ? course : product;
      return where.id === record.id ? record : null;
    } }) },
    service: () => strapi.couponService,
  };
  strapi.coupon = { code: 'TEN', discountType: 'percentage', discountValue: 10,
    appliesToAllCourses: true, isActive: true, usedCount: 0 };
  strapi.couponService = couponFactory({ strapi });
  return strapi;
}
const input = changes => ({ user: 5, cartItems: [{ type: 'course', id: 7, price: 0, slug: 'fake' }],
  paymentMethod: 'free', paymentStatus: 'paid', totalPrice: 0, ...changes });
const save = async data => data;

test('قیمت جعلی و پرداخت رایگان مرورگر بی‌اثر است', async () => {
  const order = await createCheckout(fixture(), input(), save);
  assert.equal(order.totalPrice, 98);
  assert.equal(order.paymentStatus, 'pending_payment');
  assert.equal(order.paymentMethod, 'online');
  assert.equal(order.items[0].slug, 'course');
  assert.equal(order.items[0].courseId, 7);
});
test('گردکردن تخفیف دوره و کوپن مطابق master باقی می‌ماند', async () => {
  const order = await createCheckout(fixture(), input({ couponCode: 'TEN' }), save);
  assert.equal(order.originalTotalPrice, 98);
  assert.equal(order.discountAmount, 10);
  assert.equal(order.totalPrice, 88);
});
test('سبد مختلط دوره، فصل و تعداد کالا حفظ می‌شود', async () => {
  const result = await priceCart(fixture(), [{ type: 'course', id: 7 },
    { type: 'chapter', courseId: 7, chapterId: 22, price: 0 }, { type: 'product', id: 8, quantity: 3, price: 0 }]);
  assert.equal(result.total, 738);
  assert.equal(result.items[1].price, 40);
  assert.equal(result.items[2].quantity, 3);
});
test('قیمت بین‌المللی دوره از کاتالوگ گرفته می‌شود', async () => {
  const result = await priceCart(fixture({ internationalPrice: 500 }), [{ type: 'course', id: 7 }], { isForeign: true });
  assert.equal(result.total, 500);
});
test('تخفیف منقضی اعمال نمی‌شود', async () => {
  assert.equal((await priceCart(fixture({ discountUntil: '2000-01-01' }), [{ type: 'course', id: 7 }])).total, 109);
});
test('کارت‌به‌کارت موجود در master حفظ می‌شود و پرداخت‌نشده می‌ماند', async () => {
  const order = await createCheckout(fixture(), input({ paymentMethod: 'card_to_card' }), save);
  assert.equal(order.paymentMethod, 'card_to_card');
  assert.equal(order.paymentStatus, 'pending_payment');
});
test('دوره واقعاً رایگان از کاتالوگ قابل خرید است', async () => {
  const order = await createCheckout(fixture({ price: 0 }), input(), save);
  assert.equal(order.totalPrice, 0);
  assert.equal(order.paymentStatus, 'paid');
});
test('کوپن کامل پیش از ذخیره مصرف می‌شود', async () => {
  const strapi = fixture();
  strapi.coupon.discountValue = 100;
  let consumed = false;
  strapi.couponService.consumeCoupon = async () => { consumed = true; return { success: true }; };
  const order = await createCheckout(strapi, input({ couponCode: 'TEN' }), async data => {
    assert.equal(consumed, true); return data;
  });
  assert.equal(order.paymentStatus, 'paid');
});
test('شکست مصرف کوپن مانع ثبت و تحویل رایگان است', async () => {
  const strapi = fixture();
  strapi.coupon.discountValue = 100;
  strapi.couponService.consumeCoupon = async () => ({ success: false, message: 'ظرفیت تمام شد' });
  let saved = false;
  await assert.rejects(createCheckout(strapi, input({ couponCode: 'TEN' }), async () => { saved = true; }));
  assert.equal(saved, false);
});
test('کوپن جعلی یا منقضی پذیرفته نمی‌شود', async () => {
  const strapi = fixture(); strapi.coupon.expiresAt = '2000-01-01';
  await assert.rejects(createCheckout(strapi, input({ couponCode: 'TEN' }), save));
});
test('شماره فصل مجوز استفاده از کوپن یک دوره دیگر نیست', async () => {
  const strapi = fixture();
  strapi.coupon.appliesToAllCourses = false;
  strapi.coupon.courses = [{ id: 22, documentId: 'other-course', slug: 'other' }];
  await assert.rejects(createCheckout(strapi, input({ couponCode: 'TEN',
    cartItems: [{ type: 'chapter', courseId: 7, chapterId: 22 }] }), save));
});
test('شارژ با نرخ سرور قیمت‌گذاری و نشانگر مالی مرورگر حذف می‌شود', async () => {
  const order = await createCheckout(fixture(), input({ cartItems: [{ type: 'light_topup', lightAmount: 3, price: 0 }],
    pricingContext: { lightToTomanRate: 1000 }, notes: '[LIGHT_AMOUNT:999] [TOPUP_ID:fake]' }), save);
  assert.equal(order.totalPrice, 3000);
  assert.equal(order.paymentStatus, 'pending_payment');
  assert.match(order.notes, /\[LIGHT_AMOUNT:3\]/);
  assert.doesNotMatch(order.notes, /999|fake/);
});
for (const [name, items] of [
  ['سبد خالی', []], ['نوع نامعتبر', [{ type: 'other', id: 7 }]],
  ['دوره منتشرنشده', [{ type: 'course', documentId: 'missing' }]],
  ['فصل دوره دیگر', [{ type: 'chapter', courseId: 7, chapterId: 99 }]],
  ['فصل بدون والد', [{ type: 'chapter', chapterId: 22 }]],
  ['شناسه فصل روی دوره کامل', [{ type: 'course', id: 7, chapterId: 22 }]],
  ['تعداد منفی', [{ type: 'product', id: 8, quantity: -1 }]],
  ['تعداد کسری', [{ type: 'product', id: 8, quantity: 1.5 }]],
  ['تعداد بیش از یک دوره', [{ type: 'course', id: 7, quantity: 2 }]],
  ['قلم تکراری', [{ type: 'course', id: 7 }, { type: 'course', documentId: 'course-seven' }]],
]) test(`${name} رد می‌شود`, async () => { await assert.rejects(priceCart(fixture(), items)); });
test('قیمت نامعتبر کاتالوگ رد می‌شود', async () => {
  await assert.rejects(priceCart(fixture({ price: null }), [{ type: 'course', id: 7 }]));
});
test('کاربر عادی ایجاد یا ویرایش مستقیم سفارش و checkout سرویس را انجام نمی‌دهد', async () => {
  const controller = controllerFactory({ strapi: fixture() });
  for (const action of ['create', 'update', 'checkout']) {
    const result = await controller[action]({ state: { user: { id: 5, role: { type: 'authenticated' } } },
      forbidden: message => ({ status: 403, message }) });
    assert.equal(result.status, 403);
  }
});
test('checkout و مصرف کوپن به توکن سرویس و مجوز موجود محدود هستند', () => {
  const orders = require('../src/api/order/routes/01-custom-order').routes;
  const coupons = require('../src/api/coupon/routes/01-custom-coupon').routes;
  assert.deepEqual(orders.find(r => r.handler === 'order.checkout').config.auth,
    { strategies: ['api-token'], scope: ['api::order.order.create'] });
  assert.deepEqual(coupons.find(r => r.handler === 'coupon.consume').config.auth,
    { strategies: ['api-token'], scope: ['api::coupon.coupon.update'] });
});
test('توکن سرویس و مدیر همچنان ایجاد و ویرایش سفارش را انجام می‌دهند', async () => {
  const controller = controllerFactory({ strapi: fixture() });
  Object.setPrototypeOf(controller, { create: async () => 'created', update: async () => 'updated' });
  for (const state of [{ auth: { strategy: { name: 'api-token' } } }, { user: { role: { type: 'administrator' } } }]) {
    assert.equal(await controller.create({ state }), 'created');
    assert.equal(await controller.update({ state }), 'updated');
  }
});
test('خرید کالا با اسلاگ مشابه دوره، دسترسی دوره نمی‌دهد؛ خرید فصل معتبر دسترسی می‌دهد', async () => {
  const excel = require('../src/api/order/services/excel-export');
  const oldExcel = excel.generateAndSaveExcelReport;
  const oldStrapi = global.strapi;
  excel.generateAndSaveExcelReport = async () => {};
  const lifecycle = require('../src/api/order/content-types/order/lifecycles');
  let updates = [];
  const order = { id: 1, stockDeducted: true, orderStatus: 'paid', user: { id: 5 },
    items: [{ __component: 'order.product-order-item', slug: 'course' }] };
  global.strapi = { db: { query: uid => ({ findOne: async () => uid === 'api::order.order' ? order : { id: 5 },
    findMany: async () => [{ id: 7 }], update: async data => { updates.push({ uid, data }); } }) } };
  try {
    await lifecycle.afterCreate({ result: { id: 1 } });
    assert.equal(updates.length, 0);
    order.items = [{ __component: 'order.course-order-item', courseId: 7, chapterId: 22 }];
    await lifecycle.afterCreate({ result: { id: 1 } });
    assert.deepEqual(updates[0].data.data.enrolledChapters, [22]);
    await new Promise(resolve => setImmediate(resolve));
  } finally { global.strapi = oldStrapi; excel.generateAndSaveExcelReport = oldExcel; }
});

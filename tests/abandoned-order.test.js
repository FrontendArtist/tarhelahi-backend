'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cancelAfterCartRemoval } = require('../src/api/order/services/abandoned-order');

function fixture(rows) {
  const updates = [];
  let beforeUpdate = () => {};
  const repository = {
    findMany: async ({ where }) => rows.filter(row => row.user.id === where.user.id &&
      row.paymentMethod === where.paymentMethod && row.orderStatus === where.orderStatus && row.paymentStatus === where.paymentStatus),
    updateMany: async ({ where, data }) => {
      beforeUpdate();
      const row = rows.find(row => row.id === where.id && row.orderStatus === where.orderStatus &&
        row.paymentStatus === where.paymentStatus && row.paymentMethod === where.paymentMethod && !row.refNum);
      updates.push({ where, data });
      if (!row) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  };
  return { strapi: { db: { query: () => repository, transaction: async fn => fn({}) } }, updates, beforeUpdate: fn => { beforeUpdate = fn; } };
}
const order = changes => ({ id: 1, documentId: 'one', user: { id: 7 }, paymentMethod: 'online',
  orderStatus: 'pending', paymentStatus: 'pending_payment', items: [{ courseId: 42 }, { courseId: 43 }], ...changes });
const input = changes => ({ userId: 7, removedItemKey: 'course:43', remainingItemKeys: [], ...changes });

test('حذف آخرین قلم سفارش آنلاین آن را لغو می‌کند و پرداخت را ناموفق بانکی اعلام نمی‌کند', async () => {
  const row = order(); const f = fixture([row]);
  assert.deepEqual(await cancelAfterCartRemoval(f.strapi, input()), { canceledOrderIds: ['one'] });
  assert.equal(row.orderStatus, 'canceled');
  assert.equal(row.paymentStatus, 'pending_payment');
});
test('حذف یکی از اقلام سفارش را لغو نمی‌کند', async () => {
  const f = fixture([order()]);
  assert.deepEqual(await cancelAfterCartRemoval(f.strapi, input({ remainingItemKeys: ['course:42'] })), { canceledOrderIds: [] });
  assert.equal(f.updates.length, 0);
});
test('وجود کالای نامرتبط در سبد مانع لغو سفارشی که همه اقلامش حذف شده نیست', async () => {
  const f = fixture([order()]);
  assert.deepEqual(await cancelAfterCartRemoval(f.strapi, input({ remainingItemKeys: ['product:99'] })), { canceledOrderIds: ['one'] });
});
test('سفارش کاربر دیگر، پرداخت‌شده و کارت‌به‌کارت لغو نمی‌شوند', async () => {
  const f = fixture([order({ user: { id: 8 } }), order({ id: 2, paymentStatus: 'paid' }), order({ id: 3, paymentMethod: 'card_to_card' })]);
  assert.deepEqual(await cancelAfterCartRemoval(f.strapi, input()), { canceledOrderIds: [] });
  assert.equal(f.updates.length, 0);
});
test('خالی‌بودن سبد بدون حذف قلم همین سفارش باعث لغو نمی‌شود', async () => {
  const f = fixture([order()]);
  assert.deepEqual(await cancelAfterCartRemoval(f.strapi, input({ removedItemKey: 'product:99' })), { canceledOrderIds: [] });
});
test('پرداخت موفق بین خواندن و نوشتن بر لغو اولویت دارد', async () => {
  const row = order(); const f = fixture([row]);
  f.beforeUpdate(() => { row.orderStatus = 'paid'; row.paymentStatus = 'paid'; });
  assert.deepEqual(await cancelAfterCartRemoval(f.strapi, input()), { canceledOrderIds: [] });
  assert.equal(row.orderStatus, 'paid');
});
test('تکرار درخواست اثر دوباره ندارد', async () => {
  const f = fixture([order()]);
  await cancelAfterCartRemoval(f.strapi, input());
  assert.deepEqual(await cancelAfterCartRemoval(f.strapi, input()), { canceledOrderIds: [] });
});
test('فصل با دوره و محصول دارای همان شناسه اشتباه نمی‌شود', async () => {
  const f = fixture([order({ items: [{ courseId: 8, chapterId: 43 }] })]);
  assert.deepEqual(await cancelAfterCartRemoval(f.strapi, input()), { canceledOrderIds: [] });
  assert.deepEqual(await cancelAfterCartRemoval(f.strapi, input({ removedItemKey: 'chapter:43' })), { canceledOrderIds: ['one'] });
});
test('ورودی نامعتبر پیش از پرس‌وجوی سفارش رد می‌شود', async () => {
  const f = fixture([order()]);
  assert.ok((await cancelAfterCartRemoval(f.strapi, input({ removedItemKey: 'course:NaN' }))).error);
  assert.ok((await cancelAfterCartRemoval(f.strapi, input({ userId: 0 }))).error);
});

test('موجودی کم‌شده با لغو برمی‌گردد و تکرار لغو آن را دوباره زیاد نمی‌کند', async () => {
  const row = order({ items: [{ productId: 4, quantity: 2 }], stockDeducted: true });
  let stock = 1;
  const repository = {
    findMany: async () => row.orderStatus === 'pending' ? [{ ...row }] : [],
    updateMany: async ({ where, data }) => {
      if (row.orderStatus !== where.orderStatus) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  };
  const query = {
    where: () => query,
    increment: async (column, quantity) => { assert.equal(column, 'stock'); stock += quantity; },
    update: async value => { assert.deepEqual(value, { is_available: true }); },
  };
  const strapi = { db: {
    query: uid => uid === 'api::order.order' ? repository : { findOne: async () => ({ id: 4 }) },
    transaction: async fn => fn({ trx: () => query }),
    metadata: { get: () => ({ tableName: 'products', attributes: {
      id: { columnName: 'id' }, stock: { columnName: 'stock' }, isAvailable: { columnName: 'is_available' },
    } }) },
  } };
  const removal = input({ removedItemKey: 'product:4' });
  assert.deepEqual(await cancelAfterCartRemoval(strapi, removal), { canceledOrderIds: ['one'] });
  assert.equal(stock, 3);
  assert.equal(row.stockDeducted, false);
  await cancelAfterCartRemoval(strapi, removal);
  assert.equal(stock, 3);
});

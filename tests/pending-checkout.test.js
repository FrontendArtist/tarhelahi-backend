'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCheckout } = require('../src/api/order/services/checkout-pricing');
const { matchesPendingOrder, PENDING_ORDER_TTL_MS, cancelSupersededCheckouts } = require('../src/api/order/services/pending-checkout');

const now = Date.now();
const data = {
  user: 5, address: 'تهران', postalCode: '123', phone: '09120000000', fullName: 'خریدار', email: 'a@example.com',
  couponCode: null, totalPrice: 300, originalTotalPrice: 300, discountAmount: 0,
  items: [{ __component: 'order.course-order-item', courseId: 7, price: 100 },
    { __component: 'order.product-order-item', productId: 8, quantity: 2, price: 100 }],
};
const pending = changes => ({ ...data, id: 1, documentId: 'pending-one', paymentMethod: 'online',
  paymentStatus: 'pending_payment', orderStatus: 'pending', createdAt: new Date(now - 1000).toISOString(), ...changes });

test('same items match regardless of order and decimal serialization', () => {
  assert.equal(matchesPendingOrder(pending({ totalPrice: '300.00', items: [...data.items].reverse() }), data, now), true);
});
for (const [name, changes] of [
  ['expired TTL', { createdAt: new Date(now - PENDING_ORDER_TTL_MS).toISOString() }],
  ['future timestamp', { createdAt: new Date(now + 1).toISOString() }],
  ['invalid timestamp', { createdAt: 'invalid' }],
  ['failed payment', { paymentStatus: 'failed' }], ['paid payment', { paymentStatus: 'paid' }],
  ['canceled order', { orderStatus: 'canceled' }], ['card to card', { paymentMethod: 'card_to_card' }],
  ['bank reference', { refNum: 'paid-reference' }], ['address', { address: 'شیراز' }],
  ['postal code', { postalCode: '456' }], ['coupon', { couponCode: 'NEW' }],
  ['price', { totalPrice: 301 }], ['discount', { discountAmount: 1 }],
  ['customer instructions', { notes: 'summary\n\nارسال فردا' }],
  ['quantity', { items: [data.items[0], { ...data.items[1], quantity: 3 }] }],
  ['chapter instead of course', { items: [{ ...data.items[0], chapterId: 22 }, data.items[1]] }],
  ['different course', { items: [{ ...data.items[0], courseId: 9 }, data.items[1]] }],
  ['unit prices with identical total', { items: data.items.map(item => ({ ...item, price: 101 })) }],
  ['extra item', { items: [...data.items, data.items[0]] }],
]) test(`${name} is not reused`, () => assert.equal(matchesPendingOrder(pending(changes), data, now), false));

function fixture() {
  const orders = [];
  let price = 100, validCoupon = true, reads = 0;
  const strapi = {
    documents: () => ({ findOne: async () => {
      reads++;
      return { id: 7, documentId: 'course-seven', title: 'Course', slug: 'course', price };
    } }),
    service: () => ({ validateAndCalculate: async () => ({ valid: validCoupon,
      finalTotalPrice: price - 10, discountAmount: 10, message: 'expired' }) }),
    db: { transaction: async fn => fn({ trx: { raw: async () => {} } }),
      query: () => ({ findMany: async ({ where }) => orders.filter(order => order.user === where.user.id),
        updateMany: async ({ where, data }) => {
          const order = orders.find(order => order.id === where.id && order.user === where.user.id &&
            order.paymentMethod === where.paymentMethod && order.orderStatus === where.orderStatus &&
            order.paymentStatus === where.paymentStatus && !order.refNum);
          if (!order) return { count: 0 };
          Object.assign(order, data); return { count: 1 };
        } }) },
  };
  const input = { ...data, cartItems: [{ type: 'course', documentId: 'course-seven' }], paymentMethod: 'online' };
  const save = async fields => {
    const order = { ...fields, id: orders.length + 1, documentId: `order-${orders.length + 1}`, createdAt: new Date().toISOString() };
    orders.push(order);
    return { data: order };
  };
  const reuse = order => ({ data: order });
  return { strapi, input, save, reuse, orders, setPrice: value => { price = value; },
    expireCoupon: () => { validCoupon = false; }, reads: () => reads };
}

test('retry returns same documentId, revalidates catalog and does not save twice', async () => {
  const f = fixture();
  const first = await createCheckout(f.strapi, f.input, f.save, f.reuse);
  const second = await createCheckout(f.strapi, f.input, f.save, f.reuse);
  assert.equal(first.data.documentId, second.data.documentId);
  assert.equal(f.orders.length, 1);
  assert.equal(f.reads(), 2);
});
test('price change creates new order and cancels previous pending order', async () => {
  const f = fixture();
  await createCheckout(f.strapi, f.input, f.save, f.reuse);
  f.setPrice(110);
  await createCheckout(f.strapi, f.input, f.save, f.reuse);
  assert.equal(f.orders.length, 2);
  assert.equal(f.orders[0].totalPrice, 100);
  assert.equal(f.orders[0].orderStatus, 'canceled');
  assert.equal(f.orders[0].paymentStatus, 'pending_payment');
  assert.equal(f.orders[0].rejectionReason, 'جایگزین‌شده با سفارش جدید');
  assert.equal(f.orders[1].orderStatus, 'pending');
});

test('retry keeps matching order and cancels older duplicate pending orders', async () => {
  const f = fixture();
  await createCheckout(f.strapi, f.input, f.save, f.reuse);
  f.orders.push({ ...f.orders[0], id: 99, documentId: 'old-duplicate',
    createdAt: new Date(Date.now() - PENDING_ORDER_TTL_MS - 1000).toISOString() });
  const result = await createCheckout(f.strapi, f.input, f.save, f.reuse);
  assert.equal(result.data.documentId, f.orders[0].documentId);
  assert.equal(f.orders[0].orderStatus, 'pending');
  assert.equal(f.orders[1].orderStatus, 'canceled');
});

test('new checkout preserves admin card-to-card orders and paid orders', async () => {
  const f = fixture();
  await createCheckout(f.strapi, f.input, f.save, f.reuse);
  f.orders[0].paymentMethod = 'card_to_card';
  f.orders.push({ ...f.orders[0], id: 99, paymentMethod: 'online', paymentStatus: 'paid', orderStatus: 'paid' });
  await createCheckout(f.strapi, f.input, f.save, f.reuse);
  assert.equal(f.orders[0].orderStatus, 'pending');
  assert.equal(f.orders[1].orderStatus, 'paid');
  assert.equal(f.orders[2].orderStatus, 'pending');
});
test('expired coupon is rejected even when matching pending order exists', async () => {
  const f = fixture(); f.input.couponCode = 'TEN';
  await createCheckout(f.strapi, f.input, f.save, f.reuse);
  f.expireCoupon();
  await assert.rejects(createCheckout(f.strapi, f.input, f.save, f.reuse), /expired/);
  assert.equal(f.orders.length, 1);
});
test('another user cannot reuse order', async () => {
  const f = fixture();
  await createCheckout(f.strapi, f.input, f.save, f.reuse);
  await createCheckout(f.strapi, { ...f.input, user: 6 }, f.save, f.reuse);
  assert.equal(f.orders.length, 2);
});

test('superseding releases reserved product stock once and keeps bank status pending', async () => {
  const order = pending({ stockDeducted: true, items: [{ productId: 8, quantity: 2 }] });
  let stock = 1;
  const repository = {
    findMany: async () => order.orderStatus === 'pending' ? [{ ...order }] : [],
    updateMany: async ({ where, data }) => {
      if (order.orderStatus !== where.orderStatus) return { count: 0 };
      Object.assign(order, data); return { count: 1 };
    },
  };
  const query = { where: () => query, increment: async (_, quantity) => { stock += quantity; }, update: async () => {} };
  const strapi = { db: { query: uid => uid === 'api::order.order' ? repository : { findOne: async () => ({ id: 8 }) },
    metadata: { get: () => ({ tableName: 'products', attributes: {
      id: { columnName: 'id' }, stock: { columnName: 'stock' }, isAvailable: { columnName: 'is_available' },
    } }) } } };
  await cancelSupersededCheckouts(strapi, () => query, 5);
  assert.equal(stock, 3);
  assert.equal(order.stockDeducted, false);
  assert.equal(order.paymentStatus, 'pending_payment');
  await cancelSupersededCheckouts(strapi, () => query, 5);
  assert.equal(stock, 3);
});

test('payment completed between lookup and cancellation is preserved', async () => {
  const order = pending();
  const strapi = { db: { query: () => ({
    findMany: async () => [{ ...order }],
    updateMany: async ({ where }) => {
      order.orderStatus = 'paid'; order.paymentStatus = 'paid';
      assert.equal(where.orderStatus, 'pending');
      assert.equal(where.paymentStatus, 'pending_payment');
      return { count: 0 };
    },
  }) } };
  await cancelSupersededCheckouts(strapi, {}, 5);
  assert.equal(order.orderStatus, 'paid');
});

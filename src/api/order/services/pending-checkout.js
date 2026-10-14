'use strict';

const PENDING_ORDER_TTL_MS = 30 * 60 * 1000;
const LOCK_NAMESPACE = 1869767794;
const { restoreStock } = require('./abandoned-order');

function itemSignature(items) {
  return JSON.stringify(items.map(item => [
    item.__component, Number(item.courseId || 0), Number(item.chapterId || 0),
    Number(item.productId || 0), Number(item.quantity ?? 1), Number(item.price),
  ]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

function matchesPendingOrder(order, data, now) {
  const createdAt = new Date(order.createdAt).getTime();
  return order.paymentMethod === 'online' && order.paymentStatus === 'pending_payment' &&
    order.orderStatus === 'pending' && !order.refNum &&
    Number.isFinite(createdAt) && createdAt <= now && createdAt > now - PENDING_ORDER_TTL_MS &&
    ['address', 'postalCode', 'phone', 'fullName', 'email'].every(key => order[key] === data[key]) &&
    (order.couponCode || null) === data.couponCode &&
    // The generated item summary may change order; customer instructions must remain identical.
    String(order.notes || '').split('\n\n---\n')[0].split('\n\n').slice(1).join('\n\n') ===
      String(data.notes || '').split('\n\n---\n')[0].split('\n\n').slice(1).join('\n\n') &&
    ['totalPrice', 'originalTotalPrice', 'discountAmount'].every(key =>
      order[key] != null && Number(order[key]) === data[key]) &&
    Array.isArray(order.items) && itemSignature(order.items) === itemSignature(data.items);
}

async function lockPendingCheckout(trx, userId) {
  // A transaction lock works across all Next.js and Strapi instances and is released on rollback too.
  await trx.raw('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_NAMESPACE, userId]);
}

async function findPendingCheckout(strapi, data) {
  const now = Date.now();
  const orders = await strapi.db.query('api::order.order').findMany({
    where: {
      user: { id: data.user }, paymentMethod: 'online', paymentStatus: 'pending_payment',
      orderStatus: 'pending', refNum: { $null: true },
      // Core REST services default to published; reuse the same version read by payment/request.
      publishedAt: { $notNull: true },
      createdAt: { $gt: new Date(now - PENDING_ORDER_TTL_MS), $lte: new Date(now) },
    },
    populate: ['items'], orderBy: { createdAt: 'desc' },
  });
  return orders.find(order => matchesPendingOrder(order, data, now));
}

async function cancelSupersededCheckouts(strapi, trx, userId, keepDocumentId = null) {
  const repository = strapi.db.query('api::order.order');
  const orders = await repository.findMany({
    where: { user: { id: userId }, paymentMethod: 'online', orderStatus: 'pending',
      paymentStatus: 'pending_payment', refNum: { $null: true } },
    populate: ['items'],
  });
  for (const order of orders) {
    // Draft and published rows share documentId but have different numeric IDs.
    if ((keepDocumentId && order.documentId === keepDocumentId) || !order.items?.length ||
      order.items.some(item => !item.courseId && !item.productId)) continue;
    // The conditional update also locks the row until stock restoration and checkout commit.
    const changed = await repository.updateMany({
      where: { id: order.id, paymentMethod: 'online',
        orderStatus: 'pending', paymentStatus: 'pending_payment', refNum: { $null: true } },
      data: { orderStatus: 'canceled', rejectionReason: 'جایگزین‌شده با سفارش جدید', updatedAt: new Date() },
    });
    if (changed.count > 0) await restoreStock(strapi, trx, order);
  }
}

module.exports = { PENDING_ORDER_TTL_MS, matchesPendingOrder, lockPendingCheckout, findPendingCheckout, cancelSupersededCheckouts };

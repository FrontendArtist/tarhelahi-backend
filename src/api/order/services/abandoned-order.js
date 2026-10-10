'use strict';

const ORDER_UID = 'api::order.order';
const keyOf = item => {
  if (item.chapterId) return `chapter:${item.chapterId}`;
  if (item.courseId) return `course:${item.courseId}`;
  return item.productId ? `product:${item.productId}` : null;
};
const validKey = key => typeof key === 'string' && /^(course|chapter|product):[1-9]\d*$/.test(key);

async function restoreStock(strapi, trx, order) {
  if (!order.stockDeducted) return;
  const uid = 'api::product.product';
  const metadata = strapi.db.metadata.get(uid);
  for (const item of order.items || []) {
    if (!item.productId || item.courseId || item.chapterId) continue;
    const product = await strapi.db.query(uid).findOne({ where: { id: item.productId }, select: ['id'] });
    if (!product) continue;
    // افزایش اتمی موجودی، خرید هم‌زمان دیگر کاربران را بازنویسی نمی‌کند.
    await trx(metadata.tableName).where(metadata.attributes.id.columnName, product.id)
      .increment(metadata.attributes.stock.columnName, Math.max(1, Number(item.quantity) || 1));
    await trx(metadata.tableName).where(metadata.attributes.id.columnName, product.id)
      .update({ [metadata.attributes.isAvailable.columnName]: true });
  }
  await strapi.db.query(ORDER_UID).updateMany({ where: { id: order.id, orderStatus: 'canceled' }, data: { stockDeducted: false } });
}

async function cancelAfterCartRemoval(strapi, input) {
  const { userId, removedItemKey, remainingItemKeys } = input;
  if (!Number.isSafeInteger(userId) || userId < 1 || !validKey(removedItemKey) ||
      !Array.isArray(remainingItemKeys) || remainingItemKeys.length > 500 || !remainingItemKeys.every(validKey)) {
    return { error: 'اطلاعات حذف قلم از سبد نامعتبر است.' };
  }
  const remaining = new Set(remainingItemKeys);
  const repository = strapi.db.query(ORDER_UID);
  const orders = await repository.findMany({
    where: { user: { id: userId }, paymentMethod: 'online', orderStatus: 'pending', paymentStatus: 'pending_payment' },
    populate: ['items'],
  });
  const canceledOrderIds = new Set();
  for (const order of orders) {
    const keys = (order.items || []).map(keyOf);
    // فقط حذف دستی قلم همین سفارش، پس از حذف آخرین قلم آن، مجوز لغو می‌دهد.
    if (!keys.includes(removedItemKey) || keys.some(key => !key || remaining.has(key))) continue;
    // شرط وضعیت در خود UPDATE است؛ رسیدن پرداخت موفق بین خواندن و نوشتن باعث لغو آن نمی‌شود.
    const changed = await strapi.db.transaction(async ({ trx }) => {
      const result = await repository.updateMany({
        where: { id: order.id, paymentMethod: 'online', orderStatus: 'pending', paymentStatus: 'pending_payment', refNum: { $null: true } },
        data: { orderStatus: 'canceled', rejectionReason: 'لغو به دلیل حذف دستی تمام اقلام سفارش از سبد خرید', updatedAt: new Date() },
      });
      if (result.count === 0) return false;
      await restoreStock(strapi, trx, order);
      return true;
    });
    if (changed) canceledOrderIds.add(order.documentId || String(order.id));
  }
  return { canceledOrderIds: [...canceledOrderIds] };
}

module.exports = { cancelAfterCartRemoval };

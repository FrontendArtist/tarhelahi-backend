'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const stock = require('./stockReservation');
const managedOrder = new AsyncLocalStorage();
const ORDER_UID = 'api::order.order';
const ORDER_LOCK = 1869767802;
const MUTATIONS = ['create', 'clone', 'update', 'publish', 'unpublish', 'discardDraft', 'delete'];

async function productItems(strapi, items) {
  const quantities = new Map();
  for (const item of items || []) {
    if (item.__component !== 'order.product-order-item' || item.slug === 'light-topup') {
      continue;
    }
    const product = item.productId ? await strapi.db.query(stock.PRODUCT_UID).findOne({
      where: { id: Number(item.productId) },
    }) : await strapi.db.query(stock.PRODUCT_UID).findOne({ where: { slug: item.slug } });
    if (!product || !Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      stock.conflict('کالا یا تعداد سفارش معتبر نیست.');
    }
    quantities.set(product.documentId, (quantities.get(product.documentId) || 0) + item.quantity);
  }
  return [...quantities].map(([externalId, quantity]) => ({ externalId, quantity }));
}

function reservationId(order) {
  return order.inventoryReservationId || `legacy:${order.documentId}`;
}

async function markOrder(strapi, documentId, id, deducted) {
  await strapi.db.query(ORDER_UID).updateMany({
    where: { documentId },
    data: { inventoryReservationId: id, stockDeducted: deducted },
  });
}

async function releaseLegacy(strapi, trx, order) {
  if (!order.stockDeducted) {
    return;
  }
  const id = reservationId(order);
  await stock.lock(trx, stock.RESERVATION_LOCK, id);
  const existing = await trx(stock.RESERVATION_TABLE).where({ reservation_id: id }).first();
  if (!existing) {
    const items = await productItems(strapi, order.items);
    if (items.length === 0) {
      return;
    }
    await stock.reserve(strapi, trx, id, items, { adopt: true });
  }
  await stock.transition(strapi, trx, id, 'release');
  await markOrder(strapi, order.documentId, id, false);
}

async function reconcileOrder(strapi, trx, order, previous) {
  const items = await productItems(strapi, order.items);
  const id = reservationId(order);
  if (items.length === 0) {
    if (previous?.inventoryReservationId) {
      stock.conflict('حذف اقلام سفارش دارای رزرو از ویرایش مستقیم مجاز نیست.');
    }
    return;
  }
  if (['canceled', 'cancelled'].includes(order.orderStatus) || order.paymentStatus === 'failed') {
    if (previous?.paymentStatus === 'paid' || ['paid', 'shipped', 'delivered'].includes(previous?.orderStatus)) {
      stock.conflict('آزادسازی موجودی سفارش پرداخت‌شده به مسیر لغو مجاز نیاز دارد.');
    }
    await releaseLegacy(strapi, trx, previous || order);
    return;
  }
  // پذیرش سابقهٔ قدیمی فقط در ویرایش سابقه است؛ ورودی ایجاد تازه حق جعل stockDeducted ندارد.
  if (previous?.stockDeducted === true && !previous.inventoryReservationId) {
    await stock.reserve(strapi, trx, id, await productItems(strapi, previous.items), { adopt: true });
  }
  await stock.reserve(strapi, trx, id, items);
  if (order.paymentStatus === 'paid' || ['paid', 'shipped', 'delivered'].includes(order.orderStatus)) {
    await stock.transition(strapi, trx, id, 'commit');
  }
  await markOrder(strapi, order.documentId, id, true);
}

function documentMiddleware(strapi) {
  return async (context, next) => {
    if (!MUTATIONS.includes(context.action)) {
      return next();
    }
    if (context.uid === stock.PRODUCT_UID) {
      return strapi.db.transaction(async ({ trx }) => {
        const documentId = context.params.documentId;
        let current;
        if (documentId) {
          await stock.lock(trx, stock.PRODUCT_LOCK, documentId);
          current = await stock.inventory(strapi, trx, documentId);
          if (context.action === 'delete') {
            const held = await trx(stock.RESERVATION_TABLE).where({ state: 'reserved' })
              .whereJsonSupersetOf('items', [{ externalId: documentId }]).first();
            if (held) {
              stock.conflict('کالای دارای رزرو فعال قابل حذف نیست.');
            }
          }
        }
        const explicitStock = context.action === 'clone' ? undefined : context.params.data?.stock;
        if (explicitStock != null &&
          (!Number.isSafeInteger(Number(explicitStock)) || Number(explicitStock) < 0)) {
          stock.conflict('موجودی کالا معتبر نیست.');
        }
        if (current && context.action === 'update') {
          context.params.data = {
            ...context.params.data,
            stock: explicitStock == null ? current.available_quantity : Number(explicitStock),
          };
        }
        const result = await next();
        if (context.action === 'delete') {
          return result;
        }
        const targetId = context.action === 'clone' ? result?.documentId : documentId || result?.documentId;
        if (targetId) {
          if (targetId !== documentId) {
            await stock.lock(trx, stock.PRODUCT_LOCK, targetId);
          }
          const row = await stock.inventory(strapi, trx, targetId);
          const quantity = explicitStock != null ? Number(explicitStock) : row.available_quantity;
          await trx(stock.INVENTORY_TABLE).where({ document_id: targetId }).update({ available_quantity: quantity });
          await stock.mirror(strapi, trx, targetId, quantity);
        }
        return result;
      });
    }
    if (context.uid !== ORDER_UID || managedOrder.getStore()) {
      return next();
    }
    return strapi.db.transaction(async ({ trx }) => {
      const documentId = context.params.documentId;
      let previous;
      if (documentId) {
        await stock.lock(trx, ORDER_LOCK, documentId);
        const versions = await strapi.db.query(ORDER_UID).findMany({
          where: { documentId }, populate: ['items'], orderBy: { id: 'asc' },
        });
        previous = versions.find((row) => row.publishedAt) || versions[0];
      }
      if (context.params.data) {
        delete context.params.data.inventoryReservationId;
        delete context.params.data.stockDeducted;
      }
      if (context.action === 'delete' && previous?.stockDeducted) {
        stock.conflict('سفارش دارای سابقهٔ موجودی از این مسیر قابل حذف نیست.');
      }
      const result = await next();
      const targetId = context.action === 'clone' ? result?.documentId : documentId || result?.documentId;
      if (targetId && context.action !== 'delete') {
        const versions = await strapi.db.query(ORDER_UID).findMany({
          where: { documentId: targetId }, populate: ['items'], orderBy: { id: 'asc' },
        });
        const order = versions.find((row) => row.publishedAt) || versions[0];
        if (order) {
          const isNew = ['clone', 'create'].includes(context.action);
          await reconcileOrder(strapi, trx, isNew ? { ...order, inventoryReservationId: null, stockDeducted: false } : order, isNew ? null : previous);
        }
      }
      return result;
    });
  };
}

module.exports = { documentMiddleware, releaseLegacy, productItems, managedOrder };

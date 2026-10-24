'use strict';

const PRODUCT_UID = 'api::product.product';
const INVENTORY_TABLE = 'physical_product_inventory';
const RESERVATION_TABLE = 'physical_stock_reservations';
// قفل شناسهٔ رزرو حتی پیش از INSERT و قفل documentId مستقل از نسخهٔ انتشار لازم‌اند.
// Query Engine قفل تراکنشی PostgreSQL ندارد؛ SQL فقط برای همین قفل پارامتری است.
const RESERVATION_LOCK = 1869767800;
const PRODUCT_LOCK = 1869767801;
const RESERVATION_TTL_MS = 30 * 60 * 1000;

function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  error.code = 'CART_CONFLICT';
  throw error;
}

function lineFailure(item, reason, availableQuantity) {
  const messages = {
    OUT_OF_STOCK: 'موجودی این کالا تمام شده است.',
    INSUFFICIENT_STOCK: 'تعداد درخواستی بیشتر از موجودی کالا است.',
    SALE_STOPPED: 'فروش این قلم متوقف شده است.',
  };
  const error = new Error(messages[reason]);
  error.status = 409;
  error.code = 'CART_UNAVAILABLE';
  error.lineError = {
    externalId: item.externalId,
    type: item.type || 'product',
    quantity: item.quantity,
    reason,
    ...(availableQuantity == null ? {} : { availableQuantity }),
  };
  throw error;
}

function normalizeItems(items) {
  // درایور پیکربندی‌شدهٔ استرپی JSONB را متن برمی‌گرداند؛ اتصال مستقل pg آرایه می‌دهد.
  const selection = typeof items === 'string' ? JSON.parse(items) : items;
  if (!Array.isArray(selection)) {
    conflict('اقلام رزرو ذخیره‌شده معتبر نیستند.');
  }
  const seen = new Set();
  const normalized = selection.map((item) => {
    if (
      typeof item.externalId !== 'string' || !item.externalId.trim() ||
      !Number.isSafeInteger(item.quantity) || item.quantity <= 0 ||
      seen.has(item.externalId)
    ) {
      conflict('اقلام رزرو موجودی معتبر نیستند.');
    }
    seen.add(item.externalId);
    return { externalId: item.externalId, quantity: item.quantity, type: 'product' };
  });
  return normalized.sort((left, right) => left.externalId < right.externalId ? -1 : 1);
}

async function lock(trx, namespace, key) {
  await trx.raw('SELECT pg_advisory_xact_lock(?, hashtext(?))', [namespace, key]);
}

async function lockProducts(trx, items) {
  for (const item of items) {
    await lock(trx, PRODUCT_LOCK, item.externalId);
  }
}

async function inventory(strapi, trx, externalId) {
  let row = await trx(INVENTORY_TABLE).where({ document_id: externalId }).forUpdate().first();
  if (!row) {
    const versions = await strapi.db.query(PRODUCT_UID).findMany({
      where: { documentId: externalId },
      orderBy: { id: 'asc' },
    });
    const product = versions.find((version) => version.publishedAt) || versions[0];
    if (!product) {
      lineFailure({ externalId, quantity: 1 }, 'SALE_STOPPED');
    }
    const quantity = Number(product.stock ?? 0);
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      conflict('موجودی ثبت‌شدهٔ کالا معتبر نیست.');
    }
    [row] = await trx(INVENTORY_TABLE).insert({
      document_id: externalId,
      available_quantity: quantity,
    }).returning('*');
  }
  return row;
}

async function mirror(strapi, trx, externalId, quantity) {
  const metadata = strapi.db.metadata.get(PRODUCT_UID);
  // تغییر مستقیم شمارنده از اجرای دوبارهٔ lifecycle یا ساخت نسخهٔ منتشرشده جلوگیری می‌کند.
  await trx(metadata.tableName)
    .where(metadata.attributes.documentId.columnName, externalId)
    .update({ [metadata.attributes.stock.columnName]: quantity });
}

async function assertPublished(strapi, item) {
  let product = await strapi.documents(PRODUCT_UID).findOne({
    documentId: item.externalId,
    status: 'published',
  });
  if (!product && (/^\d+$/.test(String(item.externalId)))) {
    const raw = await strapi.db.query(PRODUCT_UID).findOne({
      where: { id: Number(item.externalId), publishedAt: { $notNull: true } },
    });
    if (raw?.documentId) {
      item.externalId = raw.documentId;
      product = await strapi.documents(PRODUCT_UID).findOne({
        documentId: raw.documentId,
        status: 'published',
      });
    }
  }
  if (!product || product.isAvailable === false) {
    lineFailure(item, 'SALE_STOPPED');
  }
  return product;
}

async function reserve(strapi, trx, reservationId, selection, { adopt = false } = {}) {
  const items = normalizeItems(selection);
  const fingerprint = JSON.stringify(items);
  await lock(trx, RESERVATION_LOCK, reservationId);
  const existing = await trx(RESERVATION_TABLE).where({ reservation_id: reservationId }).first();
  if (existing) {
    if (existing.fingerprint !== fingerprint || existing.state === 'released') {
      conflict('شناسهٔ رزرو با درخواست قبلی سازگار نیست.');
    }
    return existing;
  }
  await lockProducts(trx, items);
  const rows = [];
  for (const item of items) {
    if (!adopt) {
      await assertPublished(strapi, item);
    }
    const row = await inventory(strapi, trx, item.externalId);
    if (!adopt && row.available_quantity < item.quantity) {
      lineFailure(item, row.available_quantity === 0 ? 'OUT_OF_STOCK' : 'INSUFFICIENT_STOCK', row.available_quantity);
    }
    rows.push(row);
  }
  // ابتدا کفایت تمام اقلام بررسی می‌شود؛ نوشتن‌ها همگی در تراکنش فراخواننده‌اند.
  if (!adopt) {
    for (const [index, item] of items.entries()) {
      const quantity = rows[index].available_quantity - item.quantity;
      await trx(INVENTORY_TABLE).where({ document_id: item.externalId }).update({ available_quantity: quantity });
      await mirror(strapi, trx, item.externalId, quantity);
    }
  }
  const now = new Date();
  const [reservation] = await trx(RESERVATION_TABLE).insert({
    reservation_id: reservationId,
    fingerprint,
    items: JSON.stringify(items),
    state: 'reserved',
    created_at: now,
    expires_at: new Date(now.getTime() + RESERVATION_TTL_MS),
  }).returning('*');
  return reservation;
}

async function transition(strapi, trx, reservationId, action) {
  await lock(trx, RESERVATION_LOCK, reservationId);
  const reservation = await trx(RESERVATION_TABLE).where({ reservation_id: reservationId }).forUpdate().first();
  if (!reservation) {
    conflict('سابقهٔ رزرو موجودی یافت نشد.');
  }
  if (action === 'release' && reservation.state === 'released') {
    return reservation;
  }
  if (action === 'commit' && reservation.state === 'committed') {
    return reservation;
  }
  if (reservation.state !== 'reserved') {
    conflict('وضعیت رزرو موجودی اجازهٔ این عملیات را نمی‌دهد.');
  }
  const items = normalizeItems(reservation.items);
  await lockProducts(trx, items);
  if (action === 'check') {
    for (const item of items) {
      await assertPublished(strapi, item);
    }
    return reservation;
  }
  if (action === 'release') {
    for (const item of items) {
      const row = await inventory(strapi, trx, item.externalId);
      const quantity = row.available_quantity + item.quantity;
      if (!Number.isSafeInteger(quantity)) {
        conflict('موجودی کالا از محدودهٔ مجاز خارج می‌شود.');
      }
      await trx(INVENTORY_TABLE).where({ document_id: item.externalId }).update({ available_quantity: quantity });
      await mirror(strapi, trx, item.externalId, quantity);
    }
  } else if (action !== 'commit') {
    conflict('عملیات رزرو معتبر نیست.');
  }
  const state = action === 'release' ? 'released' : 'committed';
  await trx(RESERVATION_TABLE).where({ reservation_id: reservationId }).update({ state });
  return { ...reservation, state };
}

async function available(strapi, externalId) {
  const row = await strapi.db.connection(INVENTORY_TABLE).where({ document_id: externalId }).first();
  if (row) {
    return row.available_quantity;
  }
  const product = await assertPublished(strapi, { externalId, quantity: 1 });
  return Number(product.stock ?? 0);
}

module.exports = {
  PRODUCT_UID, INVENTORY_TABLE, RESERVATION_TABLE, PRODUCT_LOCK, RESERVATION_LOCK,
  RESERVATION_TTL_MS, reserve, transition, available, inventory, mirror,
  lock, lockProducts, assertPublished, lineFailure, conflict,
};

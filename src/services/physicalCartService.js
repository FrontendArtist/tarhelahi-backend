'use strict';

const stock = require('./stockReservation');
const pricing = require('./physicalCartQuote');
const { confirmPurchase } = require('./byeMoneyPurchaseService');
const UID = 'api::byemoney-cart.byemoney-cart';
const CART_LOCK = 1869767795;
const BUYER_LOCK = 1869767796;
const COURSE_LOCK = 1869767799;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validate(input, requireIdentity) {
  if ((requireIdentity && !UUID.test(input.cartId)) ||
    typeof input.buyerExternalUserId !== 'string' || !input.buyerExternalUserId.trim() ||
    input.buyerExternalUserId.length > 100 ||
    (input.couponCode != null && (typeof input.couponCode !== 'string' ||
      !input.couponCode.trim() || input.couponCode.length > 100))) {
    pricing.invalid('شناسه، خریدار یا کوپن سبد معتبر نیست.');
  }
}

async function couponLock(strapi, trx, code) {
  const metadata = strapi.db.metadata.get('api::coupon.coupon');
  await trx(metadata.tableName)
    .whereRaw('LOWER(??) = LOWER(?)', [metadata.attributes.code.columnName, code])
    .orderBy('id').forUpdate().select('id');
}

async function preview(strapi, input) {
  validate(input, false);
  const items = pricing.selection(input);
  const buyer = await pricing.buyerProfile(strapi, input.buyerExternalUserId);
  const address = pricing.addressOf(buyer, items, true);
  const snapshot = await pricing.quote(strapi, input, items, buyer, address);
  const { cartId, reservationId, buyerExternalUserId, ...response } = snapshot;
  return response;
}

async function prepare(strapi, input) {
  validate(input, true);
  const items = pricing.selection(input);
  return strapi.db.transaction(async ({ trx }) => {
    await stock.lock(trx, CART_LOCK, input.cartId);
    const buyer = await pricing.buyerProfile(strapi, input.buyerExternalUserId);
    const address = pricing.addressOf(buyer, items, false);
    const code = input.couponCode?.trim().toUpperCase() || null;
    const fingerprint = JSON.stringify([input.buyerExternalUserId, items, code, address.addressVersion]);
    const repository = strapi.db.query(UID);
    const existing = await repository.findOne({ where: { cartId: input.cartId } });
    if (existing) {
      if (existing.fingerprint !== fingerprint || existing.state === 'released') {
        stock.conflict('شناسهٔ سبد با درخواست قبلی سازگار نیست.');
      }
      return existing.snapshot;
    }
    if (code) {
      await couponLock(strapi, trx, code);
    }
    // قفل تمام کالاها پیش از قیمت‌گذاری، خواندن قیمت/انتشار و رزرو را هم‌نسخه می‌کند.
    const physicalItems = items.filter((item) => item.type === 'product');
    await stock.lockProducts(trx, [...physicalItems].sort((left, right) => left.externalId < right.externalId ? -1 : 1));
    const snapshot = await pricing.quote(strapi, input, items, buyer, address);
    const reservation = await stock.reserve(strapi, trx, input.cartId, physicalItems);
    if (code) {
      const result = await strapi.service('api::coupon.coupon').consumeCoupon(code);
      if (!result.success) {
        stock.conflict(result.message);
      }
    }
    snapshot.contractVersion = 'physical-v1';
    snapshot.expiresAtUtc = new Date(reservation.expires_at).toISOString();
    await repository.create({
      data: {
        cartId: input.cartId,
        buyerExternalUserId: buyer.documentId,
        fingerprint,
        couponCode: code,
        snapshot,
        state: 'reserved',
      },
    });
    return snapshot;
  });
}

async function releaseCoupon(strapi, trx, code) {
  if (!code) {
    return;
  }
  await couponLock(strapi, trx, code);
  const coupon = await strapi.db.query('api::coupon.coupon').findOne({ where: { code: { $eqi: code } } });
  if (!coupon || Number(coupon.usedCount) < 1) {
    stock.conflict('سابقهٔ کوپن رزروشده معتبر نیست.');
  }
  await strapi.db.query('api::coupon.coupon').update({
    where: { id: coupon.id }, data: { usedCount: Number(coupon.usedCount) - 1 },
  });
}

// فراخوانی فقط زیر قفل سبد و در تراکنش سرویس اصلی انجام می‌شود.
async function transition(strapi, trx, cart, input, action) {
  const repository = strapi.db.query(UID);
  if (action === 'release') {
    if (cart.state === 'released') {
      return { success: true };
    }
    if (cart.state === 'committed') {
      stock.conflict('خرید پرداخت‌شده قابل آزادسازی نیست.');
    }
    await releaseCoupon(strapi, trx, cart.couponCode);
    await stock.transition(strapi, trx, cart.cartId, 'release');
    await repository.update({ where: { id: cart.id }, data: { state: 'released' } });
    return { success: true };
  }
  if (cart.state === 'released') {
    stock.conflict('رزرو سبد آزاد شده است.');
  }
  if (action === 'check') {
    if (cart.state !== 'reserved') {
      stock.conflict('خرید قبلاً نهایی شده است.');
    }
    await pricing.assertAvailable(strapi, cart.snapshot);
    await stock.transition(strapi, trx, cart.cartId, 'check');
    return { success: true };
  }
  if (action !== 'commit' || !Array.isArray(input.purchaseIds) ||
    input.purchaseIds.length !== cart.snapshot.items.length ||
    input.purchaseIds.some((id) => !UUID.test(id)) || new Set(input.purchaseIds).size !== input.purchaseIds.length) {
    pricing.invalid('شناسه‌های خرید معتبر نیست.');
  }
  if (cart.state === 'committed') {
    if (JSON.stringify(cart.purchaseIds) !== JSON.stringify(input.purchaseIds)) {
      stock.conflict('شناسه‌های خرید با ثبت قبلی متفاوت‌اند.');
    }
    // سبدهای commit‌شدهٔ قبل از بستن مسیر Legacy شناسهٔ سفارش دارند؛ تکرار commit همان پاسخ را می‌دهد.
    return { success: true, ...(cart.orderDocumentId ? { orderDocumentId: cart.orderDocumentId } : {}) };
  }
  await stock.lock(trx, BUYER_LOCK, input.buyerExternalUserId);
  const digitalItems = cart.snapshot.items.filter((item) => item.type !== 'product');
  const parentIds = [...new Set(digitalItems.map((item) => item.parentExternalId || item.externalId))].sort();
  for (const parentId of parentIds) {
    await stock.lock(trx, COURSE_LOCK, parentId);
  }
  // تثبیت موجودی و دسترسی دیجیتال در همان تراکنش‌اند؛ رکورد order موازی ساخته نمی‌شود (D08).
  await stock.transition(strapi, trx, cart.cartId, 'commit');
  for (const [index, item] of cart.snapshot.items.entries()) {
    if (item.type === 'product') {
      continue;
    }
    const result = await confirmPurchase({
      purchaseId: input.purchaseIds[index],
      buyerExternalUserId: input.buyerExternalUserId,
      item: { externalId: item.externalId, type: item.type, parentExternalId: item.parentExternalId },
    }, { strapiInstance: strapi });
    if (result.httpStatus !== 200) {
      const error = new Error(result.response.message);
      error.status = result.httpStatus;
      throw error;
    }
  }
  await repository.update({
    where: { id: cart.id },
    data: { state: 'committed', purchaseIds: input.purchaseIds },
  });
  return { success: true };
}

module.exports = { preview, prepare, transition };

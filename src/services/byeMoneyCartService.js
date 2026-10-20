'use strict';

const { discountedPrice } = require('../api/order/services/checkout-pricing');
const { confirmPurchase } = require('./byeMoneyPurchaseService');
const UID = 'api::byemoney-cart.byemoney-cart';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(message, status = 409) { const error = new Error(message); error.status = status; throw error; }
function identity(input) {
  if (!input || !UUID.test(input.cartId) || typeof input.buyerExternalUserId !== 'string' ||
      !input.buyerExternalUserId.trim() || input.buyerExternalUserId.length > 100) fail('شناسهٔ سبد یا خریدار معتبر نیست.', 400);
}
async function lockCart(trx, id) {
  await trx.raw('SELECT pg_advisory_xact_lock(?, hashtext(?))', [1869767795, id]);
}
async function lockCoupon(strapi, trx, code) {
  const metadata = strapi.db.metadata.get('api::coupon.coupon');
  await trx(metadata.tableName).whereRaw('LOWER(??) = LOWER(?)', [metadata.attributes.code.columnName, code])
    .orderBy('id').forUpdate().select('id');
}
async function loadBuyer(strapi, externalUserId) {
  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { documentId: externalUserId }, populate: ['courses'],
  });
  if (!user || !user.confirmed || user.blocked) fail('خریدار معتبر و فعال نیست.');
  return user;
}
async function assertAvailable(strapi, snapshot, buyer = null) {
  const user = buyer || await loadBuyer(strapi, snapshot.buyerExternalUserId);
  const owned = new Set((user.courses || []).map(course => course.documentId));
  for (const item of snapshot.items) {
    if (owned.has(item.externalCourseId)) fail('یکی از دوره‌های سبد قبلاً خریداری شده است.');
    const course = await strapi.documents('api::course.course').findOne({ documentId: item.externalCourseId, status: 'published' });
    if (!course) fail('یکی از دوره‌های سبد دیگر قابل خرید نیست.');
  }
}
function validateSelection(input) {
  if (!Array.isArray(input.externalCourseIds) || input.externalCourseIds.length < 1 || input.externalCourseIds.length > 100 ||
      input.externalCourseIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 100) ||
      new Set(input.externalCourseIds).size !== input.externalCourseIds.length ||
      (input.couponCode != null && (typeof input.couponCode !== 'string' || !input.couponCode.trim() || input.couponCode.length > 100))) {
    fail('اقلام یا کوپن سبد معتبر نیست.', 400);
  }
}
// پیش‌نمایش و رزرو از یک محاسبه استفاده می‌کنند؛ این تابع هیچ داده‌ای نمی‌نویسد.
async function quote(strapi, input) {
  const buyer = await loadBuyer(strapi, input.buyerExternalUserId);
  const isForeign = buyer.is_foreigner === true;
  const items = [];
  const baseItems = [];
  for (const documentId of [...input.externalCourseIds].sort()) {
    const course = await strapi.documents('api::course.course').findOne({ documentId, status: 'published' });
    if (!course) fail('دورهٔ منتشرشده یافت نشد.', 400);
    const basePrice = Number(isForeign && Number(course.internationalPrice) > 0
      ? course.internationalPrice : course.price);
    const price = discountedPrice(course, isForeign);
    if (!Number.isSafeInteger(basePrice) || !Number.isSafeInteger(price) || basePrice < price) fail('قیمت پایهٔ دوره معتبر نیست.', 400);
    items.push({ id: course.id, documentId, courseId: course.id, title: course.title, slug: course.slug, type: 'course', quantity: 1, price });
    baseItems.push({ externalCourseId: documentId, title: course.title, basePriceInNoor: basePrice,
      itemDiscountInNoor: basePrice - price, couponDiscountInNoor: 0, priceInNoor: price });
  }
  const code = input.couponCode?.trim().toUpperCase() || null;
  if (code) {
    const coupon = await strapi.service('api::coupon.coupon').validateAndCalculate(code, items, items.reduce((s, i) => s + i.price, 0));
    if (!coupon.valid) fail(coupon.message, 400);
    for (const [index, item] of items.entries()) {
      const discount = coupon.itemDiscounts.find(row => row.id === item.id)?.discountAmount || 0;
      baseItems[index].couponDiscountInNoor = discount;
      baseItems[index].priceInNoor -= discount;
    }
  }
  const snapshot = { cartId: input.cartId, buyerExternalUserId: input.buyerExternalUserId, couponCode: code, items: baseItems };
  await assertAvailable(strapi, snapshot, buyer);
  return snapshot;
}
async function preview(strapi, input) {
  validateSelection(input);
  const snapshot = await quote(strapi, input);
  return {
    couponCode: snapshot.couponCode,
    originalTotalInNoor: snapshot.items.reduce((s, i) => s + i.basePriceInNoor, 0),
    itemDiscountInNoor: snapshot.items.reduce((s, i) => s + i.itemDiscountInNoor, 0),
    couponDiscountInNoor: snapshot.items.reduce((s, i) => s + i.couponDiscountInNoor, 0),
    priceInNoor: snapshot.items.reduce((s, i) => s + i.priceInNoor, 0),
    courses: snapshot.items,
  };
}
async function prepare(strapi, input) {
  identity(input);
  validateSelection(input);
  const ids = [...input.externalCourseIds].sort();
  const code = input.couponCode?.trim().toUpperCase() || null;
  const fingerprint = JSON.stringify([input.buyerExternalUserId, ids, code]);
  return strapi.db.transaction(async ({ trx }) => {
    await lockCart(trx, input.cartId);
    const repository = strapi.db.query(UID);
    const existing = await repository.findOne({ where: { cartId: input.cartId } });
    if (existing) {
      if (existing.fingerprint !== fingerprint || existing.state === 'released') fail('شناسهٔ سبد با درخواست قبلی سازگار نیست.');
      return existing.snapshot;
    }
    if (code) await lockCoupon(strapi, trx, code);
    const snapshot = await quote(strapi, input);
    if (code) {
      const consumed = await strapi.service('api::coupon.coupon').consumeCoupon(code);
      if (!consumed.success) fail(consumed.message);
    }
    await repository.create({ data: { cartId: input.cartId, buyerExternalUserId: input.buyerExternalUserId,
      fingerprint, couponCode: code, snapshot, state: 'reserved' } });
    return snapshot;
  });
}
async function transition(strapi, input, action) {
  identity(input);
  return strapi.db.transaction(async ({ trx }) => {
    await lockCart(trx, input.cartId);
    const repository = strapi.db.query(UID);
    const cart = await repository.findOne({ where: { cartId: input.cartId } });
    if (cart && cart.buyerExternalUserId !== input.buyerExternalUserId) fail('سبد یافت نشد.', 404);
    if (action === 'release') {
      if (cart?.state === 'committed') fail('خرید پرداخت‌شده قابل آزادسازی نیست.');
      if (cart?.state === 'released') return { success: true };
      if (cart?.couponCode) {
        await lockCoupon(strapi, trx, cart.couponCode);
        const coupons = await strapi.db.query('api::coupon.coupon').findMany({ where: { code: { $eqi: cart.couponCode } } });
        if (!coupons?.[0]) fail('سابقهٔ کوپن رزروشده یافت نشد.');
        await strapi.db.query('api::coupon.coupon').update({ where: { id: coupons[0].id },
          data: { usedCount: Math.max(0, Number(coupons[0].usedCount || 0) - 1) } });
      }
      if (cart) await repository.update({ where: { id: cart.id }, data: { state: 'released' } });
      else await repository.create({ data: { cartId: input.cartId, buyerExternalUserId: input.buyerExternalUserId, state: 'released' } });
      return { success: true };
    }
    if (!cart || cart.state === 'released') fail('رزرو سبد معتبر نیست.');
    if (action === 'check') {
      if (cart.state !== 'reserved') fail('خرید قبلاً نهایی شده است.');
      await assertAvailable(strapi, cart.snapshot);
      return { success: true };
    }
    if (!Array.isArray(input.purchaseIds) || input.purchaseIds.length !== cart.snapshot.items.length ||
        input.purchaseIds.some(id => !UUID.test(id)) || new Set(input.purchaseIds).size !== input.purchaseIds.length) fail('شناسه‌های خرید معتبر نیست.', 400);
    if (cart.state === 'committed') {
      if (JSON.stringify(cart.purchaseIds) !== JSON.stringify(input.purchaseIds)) fail('شناسه‌های خرید با ثبت قبلی متفاوت‌اند.');
      return { success: true };
    }
    // دسترسی‌های تمام ردیف‌ها و وضعیت نهایی رزرو در یک تراکنش ثبت می‌شوند.
    await trx.raw('SELECT pg_advisory_xact_lock(?, hashtext(?))', [1869767796, input.buyerExternalUserId]);
    // دو خریدار هم‌زمان نباید رابطهٔ مشترک دوره را با نسخهٔ قدیمی بازنویسی کنند.
    for (const item of [...cart.snapshot.items].sort((a, b) => a.externalCourseId.localeCompare(b.externalCourseId))) {
      await trx.raw('SELECT pg_advisory_xact_lock(?, hashtext(?))', [1869767799, item.externalCourseId]);
    }
    for (const [index, item] of cart.snapshot.items.entries()) {
      const result = await confirmPurchase({ purchaseId: input.purchaseIds[index], buyerExternalUserId: input.buyerExternalUserId,
        item: { externalId: item.externalCourseId } }, { strapiInstance: strapi });
      if (result.httpStatus !== 200) fail(result.response.message, result.httpStatus);
    }
    await repository.update({ where: { id: cart.id }, data: { state: 'committed', purchaseIds: input.purchaseIds } });
    return { success: true };
  });
}
module.exports = { preview, prepare, transition, assertAvailable };

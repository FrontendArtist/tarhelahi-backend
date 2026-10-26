'use strict';

const { createHash } = require('node:crypto');
const { discountedPrice } = require('../api/order/services/checkout-pricing');
const { resolveItem, assertOwnership } = require('./chapterCatalog');
const stock = require('./stockReservation');
const shipping = require('./cartShipping');

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'CART_INVALID';
  throw error;
}

function selection(input) {
  if (input.externalCourseIds != null || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) {
    invalid('اقلام سبد مختلط معتبر نیستند.');
  }
  const keys = new Set();
  const items = input.items.map((item) => {
    if (!item || !['course', 'course_chapter', 'product'].includes(item.type) ||
      typeof item.externalId !== 'string' || !item.externalId.trim() || item.externalId.length > 100 ||
      !Number.isSafeInteger(item.quantity) || item.quantity < 1 ||
      (item.type !== 'product' && item.quantity !== 1)) {
      invalid('هویت، نوع یا تعداد ردیف سبد معتبر نیست.');
    }
    const key = `${item.type}:${item.externalId}`;
    if (keys.has(key)) {
      invalid('قلم سبد تکراری است.');
    }
    keys.add(key);
    return { externalId: item.externalId, type: item.type, quantity: item.quantity };
  });
  return items.sort((left, right) => {
    const leftKey = `${left.type}:${left.externalId}`;
    const rightKey = `${right.type}:${right.externalId}`;
    return leftKey < rightKey ? -1 : 1;
  });
}

async function buyerProfile(strapi, externalId) {
  const buyer = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { documentId: externalId },
    populate: ['courses', 'address'],
  });
  if (!buyer || !buyer.confirmed || buyer.blocked) {
    stock.conflict('خریدار معتبر و فعال نیست.');
  }
  return buyer;
}

function addressOf(buyer, items, isPreview = false) {
  if (!items.some((item) => item.type === 'product')) {
    return { addressSnapshot: null, addressVersion: null };
  }
  if (buyer.is_foreigner === true) {
    stock.conflict('فعلاً پشتیبانی نمی‌شود');
  }
  const addressSnapshot = {};
  let isComplete = true;
  for (const field of ['province', 'city', 'postalCode', 'fullAddress', 'recipientName', 'recipientPhone']) {
    const value = buyer.address?.[field];
    if (field === 'postalCode' && (value == null || value === '')) {
      addressSnapshot[field] = null;
      continue;
    }
    if (typeof value !== 'string' || !value.trim()) {
      isComplete = false;
      if (!isPreview) {
        invalid('آدرس پروفایل برای ارسال کالا کامل نیست.');
      }
      addressSnapshot[field] = field === 'recipientPhone' ? '09000000000' : 'ثبت‌نشده';
    } else {
      addressSnapshot[field] = value.trim();
    }
  }
  const addressVersion = isComplete ? createHash('sha256').update(JSON.stringify(addressSnapshot)).digest('hex') : null;
  return { addressSnapshot, addressVersion, isAddressComplete: isComplete };
}

function money(value) {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    invalid('مبلغ سبد معتبر نیست.');
  }
  return value;
}

async function quote(strapi, input, items, buyer, address) {
  const rows = [];
  const couponItems = [];
  let itemDiscountInNoor = 0;
  for (const item of items) {
    let record;
    let resolved;
    let basePrice;
    let price;
    if (item.type === 'product') {
      record = await stock.assertPublished(strapi, item);
      const availableQuantity = await stock.available(strapi, item.externalId);
      if (availableQuantity < item.quantity) {
        stock.lineFailure(item, availableQuantity === 0 ? 'OUT_OF_STOCK' : 'INSUFFICIENT_STOCK', availableQuantity);
      }
      basePrice = Number(record.price);
      price = discountedPrice(record);
    } else {
      try {
        resolved = await resolveItem(strapi, item.externalId);
        if (resolved.type !== item.type) {
          stock.lineFailure(item, 'SALE_STOPPED');
        }
        await assertOwnership(strapi, buyer, resolved);
      } catch (error) {
        if (error.status && !error.lineError) {
          error.lineError = { ...item, reason: error.reason || 'SALE_STOPPED' };
        }
        throw error;
      }
      record = resolved.chapter || resolved.course;
      basePrice = resolved.chapter ? Number(record.price) : Number(
        buyer.is_foreigner && Number(record.internationalPrice) > 0 ? record.internationalPrice : record.price,
      );
      price = resolved.chapter ? basePrice : discountedPrice(record, buyer.is_foreigner === true);
    }
    if (record.price == null || String(record.price).trim() === '' || basePrice < price) {
      invalid('قیمت پایهٔ قلم معتبر نیست.');
    }
    money(basePrice);
    money(price);
    const lineTotalInNoor = money(basePrice * item.quantity);
    itemDiscountInNoor = money(itemDiscountInNoor + (basePrice - price) * item.quantity);
    const parent = resolved?.course;
    couponItems.push({
      id: `${item.type}:${item.externalId}`,
      documentId: parent?.documentId || record.documentId,
      ...(parent ? { courseId: parent.id } : { productId: record.id }),
      slug: parent?.slug || record.slug,
      type: item.type === 'course_chapter' ? 'chapter' : item.type,
      quantity: item.quantity,
      price,
    });
    rows.push({
      ...item,
      parentExternalId: resolved?.parentExternalId || null,
      title: record.title,
      unitPriceInNoor: basePrice,
      lineTotalInNoor,
      // قیمت واحد پس از تخفیف کاتالوگ فقط ورودی سرویس ارسال است؛ تخفیف سفارش تقسیم نمی‌شود.
      discountedUnitPriceInNoor: price,
    });
  }
  const originalTotalInNoor = money(rows.reduce((sum, item) => sum + item.lineTotalInNoor, 0));
  const couponCode = input.couponCode?.trim().toUpperCase() || null;
  let couponDiscountInNoor = 0;
  const couponItemDiscounts = new Map();
  if (couponCode) {
    const result = await strapi.service('api::coupon.coupon').validateAndCalculate(
      couponCode, couponItems, originalTotalInNoor - itemDiscountInNoor,
    );
    if (!result.valid) {
      invalid(result.message);
    }
    couponDiscountInNoor = money(Number(result.discountAmount));
    if (Array.isArray(result.itemDiscounts)) {
      for (const entry of result.itemDiscounts) {
        if (entry.index !== undefined) {
          couponItemDiscounts.set(entry.index, Number(entry.discountAmount) || 0);
        } else if (entry.id !== undefined) {
          couponItemDiscounts.set(entry.id, Number(entry.discountAmount) || 0);
        }
      }
    }
  }
  const delivery = await shipping.calculate(strapi, rows, address.addressSnapshot);
  const priceInNoor = money(originalTotalInNoor - itemDiscountInNoor - couponDiscountInNoor + delivery.shippingAmountInNoor);
  const quotedItems = rows.map((row, index) => {
    const rowCatalogDiscount = (row.unitPriceInNoor - row.discountedUnitPriceInNoor) * row.quantity;
    const rowCouponDiscount = couponItemDiscounts.has(index)
      ? couponItemDiscounts.get(index)
      : (couponItemDiscounts.get(`${row.type}:${row.externalId}`) || 0);
    const rowPriceInNoor = money(row.lineTotalInNoor - rowCatalogDiscount - rowCouponDiscount);
    const { discountedUnitPriceInNoor, ...cleanRow } = row;
    return {
      ...cleanRow,
      externalCourseId: row.externalId,
      basePriceInNoor: row.unitPriceInNoor,
      itemDiscountInNoor: rowCatalogDiscount,
      couponDiscountInNoor: rowCouponDiscount,
      priceInNoor: rowPriceInNoor,
    };
  });
  return {
    cartId: input.cartId,
    reservationId: input.cartId,
    buyerExternalUserId: buyer.documentId,
    couponCode,
    items: quotedItems,
    courses: quotedItems.filter(i => i.type === 'course' || i.type === 'course_chapter'),
    originalTotalInNoor,
    itemDiscountInNoor,
    couponDiscountInNoor,
    ...delivery,
    ...address,
    priceInNoor,
  };
}

async function assertAvailable(strapi, snapshot) {
  const buyer = await buyerProfile(strapi, snapshot.buyerExternalUserId);
  for (const item of snapshot.items.filter((row) => row.type !== 'product')) {
    try {
      const resolved = await resolveItem(strapi, item.externalId, { missingStatus: 409 });
      if (resolved.type !== item.type || resolved.parentExternalId !== item.parentExternalId) {
        stock.lineFailure(item, 'SALE_STOPPED');
      }
      await assertOwnership(strapi, buyer, resolved);
    } catch (error) {
      if (error.status && !error.lineError) {
        error.lineError = { externalId: item.externalId, type: item.type, quantity: item.quantity, reason: error.reason || 'SALE_STOPPED' };
      }
      throw error;
    }
  }
}

module.exports = { selection, buyerProfile, addressOf, quote, assertAvailable, invalid };

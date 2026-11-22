'use strict';

const { createHash } = require('node:crypto');
const { discountedPrice } = require('../api/order/services/checkout-pricing');
const { resolveItem, assertOwnership, quoteChapteredCourse } = require('./chapterCatalog');
const stock = require('./stockReservation');
const shipping = require('./cartShipping');
const shippingOrigins = require('./shippingOrigins');
const fullAddressRule = require('./fullAddressRule');

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
    populate: {
      courses: true,
      address: { populate: { cityLink: { populate: { province: true } } } },
    },
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
  const link = buyer.address?.cityLink;
  const cityDocumentId = typeof link?.documentId === 'string' ? link.documentId.trim() : '';
  const linkedProvince = typeof link?.province?.name === 'string' ? link.province.name.trim() : '';
  const linkedCity = typeof link?.name === 'string' ? link.name.trim() : '';
  if (!cityDocumentId || !linkedProvince || !linkedCity) {
    invalid('شهر آدرس باید از فهرست شهرها انتخاب شود.');
  }
  const addressSnapshot = { province: linkedProvince, city: linkedCity, cityDocumentId };
  let isComplete = true;
  for (const field of ['postalCode', 'fullAddress', 'recipientName', 'recipientPhone']) {
    const value = buyer.address?.[field];
    if (field === 'postalCode' && (value == null || value === '')) {
      addressSnapshot[field] = null;
      continue;
    }
    const text = typeof value === 'string' ? value.trim() : '';
    const tooShort = field === 'fullAddress' && text && !fullAddressRule.isFullAddressLongEnough(text);
    if (!text || tooShort) {
      isComplete = false;
      if (!isPreview) {
        invalid(tooShort
          ? fullAddressRule.SHORT_FULL_ADDRESS_MESSAGE
          : 'آدرس پروفایل برای ارسال کالا کامل نیست.');
      }
      addressSnapshot[field] = field === 'recipientPhone' ? '09000000000' : 'ثبت‌نشده';
    } else {
      addressSnapshot[field] = text;
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

function couponCode(input) {
  return input.couponCode?.trim().toUpperCase() || null;
}

async function loadSettings(strapi) {
  return strapi.db.query('api::shipping-setting.shipping-setting').findOne({});
}

async function productFacts(strapi, items) {
  const records = [];
  const lines = [];
  for (const item of items) {
    if (item.type !== 'product') {
      continue;
    }
    const record = await stock.assertPublished(strapi, item);
    records.push(record);
    const factors = shipping.requireProductParcelOrConflict(record, item.quantity);
    lines.push({
      externalId: item.externalId,
      quantity: item.quantity,
      price: Number(record.price),
      discountedPrice: discountedPrice(record),
      weightGrams: factors.weightGrams,
      boxTypeId: factors.boxTypeId,
      isFragile: factors.isFragile === true,
      parcelFactors: factors,
    });
  }
  return { lines, origin: shippingOrigins.resolveCartOrigin(records) };
}

function stampFingerprint(input, items, address, facts, stamp) {
  const code = couponCode(input);
  if (!facts) {
    return JSON.stringify([input.buyerExternalUserId, items, code, address.addressVersion, null]);
  }
  return JSON.stringify([
    input.buyerExternalUserId,
    items,
    code,
    address.addressVersion,
    facts.lines.map((row) => ({
      externalId: row.externalId,
      price: row.price,
      discountedPrice: row.discountedPrice,
      weightGrams: row.weightGrams,
      boxTypeId: row.boxTypeId,
      isFragile: row.isFragile,
    })),
    { originId: facts.origin.originId, cityId: facts.origin.cityId },
    stamp,
  ]);
}

async function fingerprint(strapi, input, items, address) {
  if (!items.some((item) => item.type === 'product')) {
    return stampFingerprint(input, items, address, null, null);
  }
  const facts = await productFacts(strapi, items);
  const stamp = shipping.shippingStamp(await loadSettings(strapi));
  return stampFingerprint(input, items, address, facts, stamp);
}

function shippingRows(lines) {
  return lines.map((row) => ({
    type: 'product',
    externalId: row.externalId,
    quantity: row.quantity,
    discountedUnitPriceInNoor: row.discountedPrice,
    parcelFactors: row.parcelFactors,
  }));
}

/** خواندن اثرانگشت پستکس پیش از قفل. تماس با پستکس اینجا نیست. */
async function shippingGate(strapi, input, items) {
  if (!items.some((item) => item.type === 'product')) {
    return { callsPostex: false, fingerprint: null };
  }
  const settings = await loadSettings(strapi);
  if (shipping.readMode(settings) !== shipping.MODE_POSTEX) {
    return { callsPostex: false, fingerprint: null };
  }
  const buyer = await buyerProfile(strapi, input.buyerExternalUserId);
  const address = addressOf(buyer, items, false);
  const facts = await productFacts(strapi, items);
  const stamp = shipping.shippingStamp(settings);
  const subtotal = facts.lines.reduce((sum, row) => sum + row.discountedPrice * row.quantity, 0);
  const callsPostex = stamp.threshold == null || subtotal < stamp.threshold;
  return {
    callsPostex,
    fingerprint: stampFingerprint(input, items, address, facts, stamp),
    rows: shippingRows(facts.lines),
    addressSnapshot: address.addressSnapshot,
    fromCityId: facts.origin.cityId,
  };
}

function quoteShippingIrr(strapi, gate) {
  return shipping.postexTotalIrr(strapi, gate.rows, gate.addressSnapshot, { fromCityId: gate.fromCityId });
}

async function quote(strapi, input, items, buyer, address, options = {}) {
  const rows = [];
  const couponItems = [];
  const productRecords = [];
  let itemDiscountInNoor = 0;
  for (const item of items) {
    let record;
    let resolved;
    let basePrice;
    let price;
    if (item.type === 'product') {
      record = await stock.assertPublished(strapi, item);
      productRecords.push(record);
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
      if (
        !resolved.chapter &&
        resolved.course.isChaptered === true &&
        Array.isArray(resolved.course.chapters) &&
        resolved.course.chapters.length > 0
      ) {
        const quoted = await quoteChapteredCourse(
          strapi,
          buyer,
          resolved.course,
          buyer.is_foreigner === true,
        );
        basePrice = quoted.basePrice;
        price = quoted.price;
      } else {
        basePrice = resolved.chapter ? Number(record.price) : Number(
          buyer.is_foreigner && Number(record.internationalPrice) > 0 ? record.internationalPrice : record.price,
        );
        price = resolved.chapter ? basePrice : discountedPrice(record, buyer.is_foreigner === true);
      }
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
    const chapterTitle = resolved?.chapter && resolved?.course
      ? `${resolved.course.title} (${resolved.chapter.title})`
      : record.title;
    rows.push({
      ...item,
      parentExternalId: resolved?.parentExternalId || null,
      title: chapterTitle,
      unitPriceInNoor: basePrice,
      lineTotalInNoor,
      // قیمت واحد پس از تخفیف کاتالوگ فقط ورودی سرویس ارسال است؛ تخفیف سفارش تقسیم نمی‌شود.
      discountedUnitPriceInNoor: price,
      ...(item.type === 'product'
        ? { parcelFactors: shipping.requireProductParcelOrConflict(record, item.quantity) }
        : {}),
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
  const origin = shippingOrigins.resolveCartOrigin(productRecords);
  const delivery = await shipping.calculate(
    strapi,
    rows,
    address.addressSnapshot,
    {
      ...(origin ? { fromCityId: origin.cityId } : {}),
      ...(options.quotedTotalIrr != null ? { quotedTotalIrr: options.quotedTotalIrr } : {}),
    },
  );
  const priceInNoor = money(originalTotalInNoor - itemDiscountInNoor - couponDiscountInNoor + delivery.shippingAmountInNoor);
  const parcelByExternalId = new Map(
    (delivery.parcelQuotes || []).map((quote) => [quote.externalId, quote]),
  );
  const quotedItems = rows.map((row, index) => {
    const rowCatalogDiscount = (row.unitPriceInNoor - row.discountedUnitPriceInNoor) * row.quantity;
    const rowCouponDiscount = couponItemDiscounts.has(index)
      ? couponItemDiscounts.get(index)
      : (couponItemDiscounts.get(`${row.type}:${row.externalId}`) || 0);
    const rowPriceInNoor = money(row.lineTotalInNoor - rowCatalogDiscount - rowCouponDiscount);
    const { discountedUnitPriceInNoor, parcelFactors, ...cleanRow } = row;
    const quotedParcel = parcelByExternalId.get(row.externalId);
    const parcel = quotedParcel
      ? {
        weightGrams: quotedParcel.weightGrams,
        lengthCm: quotedParcel.lengthCm,
        widthCm: quotedParcel.widthCm,
        heightCm: quotedParcel.heightCm,
        boxTypeId: quotedParcel.boxTypeId,
        declaredValueIrr: quotedParcel.declaredValueIrr,
        isFragile: quotedParcel.isFragile === true,
      }
      : (row.type === 'product' && parcelFactors
        ? {
          weightGrams: parcelFactors.weightGrams,
          lengthCm: parcelFactors.lengthCm,
          widthCm: parcelFactors.widthCm,
          heightCm: parcelFactors.heightCm,
          boxTypeId: parcelFactors.boxTypeId,
          declaredValueIrr: null,
          isFragile: parcelFactors.isFragile === true,
        }
        : undefined);
    return {
      ...cleanRow,
      externalCourseId: row.externalId,
      basePriceInNoor: row.unitPriceInNoor,
      itemDiscountInNoor: rowCatalogDiscount,
      couponDiscountInNoor: rowCouponDiscount,
      priceInNoor: rowPriceInNoor,
      ...(parcel ? { parcel } : {}),
    };
  });
  const { parcelQuotes, ...deliveryPublic } = delivery;
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
    ...deliveryPublic,
    ...address,
    shippingOriginId: origin?.originId ?? null,
    shippingOriginLabel: origin?.displayName ?? null,
    shippingOriginCityId: origin?.cityId ?? null,
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

module.exports = {
  selection, buyerProfile, addressOf, quote, assertAvailable, invalid,
  fingerprint, shippingGate, quoteShippingIrr,
};

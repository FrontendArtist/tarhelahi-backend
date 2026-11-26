'use strict';

const { conflict } = require('./stockReservation');
const postexQuote = require('./postexShippingQuote');
const shippingCollection = require('./shippingCollection');
const localities = require('./localities');
const postexBoxes = require('./postexBoxes');

const MODE_FIXED = 'fixed';
const MODE_POSTEX = 'postex';
const IR_POST_MAX_DECLARED_VALUE_IRR = 5_000_000_000;

function readMode(settings) {
  return shippingCollection.normalizeCostMode(settings?.costMode);
}

function physicalSubtotal(items) {
  return items.reduce((sum, item) => sum + item.discountedUnitPriceInNoor * item.quantity, 0);
}

function assertThreshold(threshold) {
  if (threshold != null && (!Number.isSafeInteger(Number(threshold)) || Number(threshold) < 0)) {
    conflict('آستانهٔ ارسال رایگان معتبر نیست.');
  }
}

function rialToWholeNoor(totalIrr, rialPerNoor) {
  const rate = Number(rialPerNoor);
  if (!Number.isSafeInteger(rate) || rate < 1) {
    conflict('نرخ تبدیل ریال به نور برای ارسال معتبر نیست.');
  }
  return Math.ceil(Number(totalIrr) / rate);
}

function positiveMeasure(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * عوامل مرسوله از رکورد کالا؛ وزن گرم × تعداد؛ ابعاد از جعبهٔ استاندارد پستکس.
 * @returns {null|{ weightGrams: number, lengthCm: number, widthCm: number, heightCm: number, boxTypeId: number, isFragile: boolean }}
 */
function readParcelFactors(product, quantity) {
  if (!product || !Number.isSafeInteger(quantity) || quantity < 1) {
    return null;
  }
  const box = postexBoxes.resolve(product.boxTypeId);
  if (!box) {
    return null;
  }
  const unitWeight = positiveMeasure(product.weight);
  if (unitWeight == null) {
    return null;
  }
  const weightGrams = Math.round(unitWeight * quantity);
  if (!Number.isSafeInteger(weightGrams) || weightGrams < 1) {
    return null;
  }
  return {
    weightGrams,
    lengthCm: box.lengthCm,
    widthCm: box.widthCm,
    heightCm: box.heightCm,
    boxTypeId: box.id,
    isFragile: product.isFragile === true,
  };
}

const MISSING_BOX = 'MISSING_BOX';
const MISSING_WEIGHT = 'MISSING_WEIGHT';

function parcelSubject(item) {
  const title = typeof item?.title === 'string' ? item.title.trim() : '';
  if (title) {
    return `«${title}»`;
  }
  const externalId = typeof item?.externalId === 'string' ? item.externalId.trim() : '';
  return externalId ? `«${externalId}»` : 'کالا';
}

/** ۴۰۹ و CART_CONFLICT می‌مانند؛ قلم و علت در lineError است. */
function parcelLineConflict(item, reason) {
  const subject = parcelSubject(item);
  const message = reason === MISSING_BOX
    ? `جعبهٔ ${subject} برای ارسال تعیین نشده است.`
    : `وزن ${subject} برای ارسال ثبت نشده است.`;
  const error = new Error(message);
  error.status = 409;
  error.code = 'CART_CONFLICT';
  error.lineError = {
    externalId: item?.externalId,
    type: item?.type || 'product',
    quantity: item?.quantity,
    reason,
  };
  throw error;
}

/** نبود جعبه پیام جدا دارد؛ وزن ناقص پیام خودش را دارد. */
function requireProductParcelOrConflict(item, product) {
  const line = {
    externalId: item?.externalId,
    type: item?.type || 'product',
    quantity: item?.quantity,
    title: product?.title || item?.title,
  };
  if (!postexBoxes.resolve(product?.boxTypeId)) {
    parcelLineConflict(line, MISSING_BOX);
  }
  const factors = readParcelFactors(product, item?.quantity);
  if (!factors) {
    parcelLineConflict(line, MISSING_WEIGHT);
  }
  return factors;
}

function requireParcelFactors(item) {
  const factors = item.parcelFactors;
  const line = {
    externalId: item.externalId,
    type: item.type || 'product',
    quantity: item.quantity,
    title: item.title,
  };
  if (!factors || !Number.isSafeInteger(factors.boxTypeId) || factors.boxTypeId < 1) {
    parcelLineConflict(line, MISSING_BOX);
  }
  if (!Number.isSafeInteger(factors.weightGrams) || factors.weightGrams < 1
    || !Number.isSafeInteger(factors.lengthCm) || factors.lengthCm < 1
    || !Number.isSafeInteger(factors.widthCm) || factors.widthCm < 1
    || !Number.isSafeInteger(factors.heightCm) || factors.heightCm < 1) {
    parcelLineConflict(line, MISSING_WEIGHT);
  }
  return {
    weightGrams: factors.weightGrams,
    lengthCm: factors.lengthCm,
    widthCm: factors.widthCm,
    heightCm: factors.heightCm,
    boxTypeId: factors.boxTypeId,
    isFragile: factors.isFragile === true,
  };
}

function shippingRate(settings) {
  const rate = Number(settings?.rialPerNoorForShipping);
  if (!Number.isSafeInteger(rate) || rate < 1) {
    conflict('نرخ ریال به نور برای ارسال تنظیم نشده است.');
  }
  return rate;
}

function wholeOrNull(value) {
  if (value == null || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

/** حالت، نرخ، آستانه و مبلغ ثابت؛ نرخ نامعتبر همان تعارض محاسبه را می‌دهد. */
function shippingStamp(settings) {
  assertThreshold(settings?.freeShippingThresholdInNoor);
  return {
    costMode: readMode(settings),
    rate: shippingRate(settings),
    threshold: wholeOrNull(settings?.freeShippingThresholdInNoor),
    fixedAmount: wholeOrNull(settings?.fixedAmountInNoor),
  };
}

function assertParcelValueCap(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    conflict('ارزش ریالی قلم برای برآورد پستکس معتبر نیست.');
  }
  if (value > IR_POST_MAX_DECLARED_VALUE_IRR) {
    conflict('ارزش ریالی کالا از سقف شرکت پست (۵ میلیارد ریال) بیشتر است.');
  }
}

function lineValueIrr(item, rate) {
  const noor = Number(item.discountedUnitPriceInNoor) * Number(item.quantity);
  const value = Math.round(noor * Number(rate));
  assertParcelValueCap(value);
  return value;
}

async function calculateFixed(settings, subtotal, physicalItems) {
  const fixedAmount = settings?.fixedAmountInNoor;
  if (fixedAmount == null || !Number.isSafeInteger(Number(fixedAmount)) || Number(fixedAmount) < 0) {
    conflict('خرید کالای فیزیکی تا تنظیم مبلغ ارسال فعال نیست.');
  }
  const threshold = settings?.freeShippingThresholdInNoor;
  assertThreshold(threshold);
  const rate = shippingRate(settings);
  for (const item of physicalItems) {
    requireParcelFactors(item);
  }
  const parcelQuotes = attachDeclaredValues(physicalItems, rate);
  if (threshold != null && subtotal >= Number(threshold)) {
    return { shippingAmountInNoor: 0, shippingRuleLabel: 'ارسال رایگان', parcelQuotes };
  }
  return {
    shippingAmountInNoor: Number(fixedAmount),
    shippingRuleLabel: 'ارسال ثابت داخلی',
    parcelQuotes,
  };
}

function attachDeclaredValues(physicalItems, rate) {
  return physicalItems.map((item) => {
    const factors = item.parcelFactors;
    if (!factors) {
      return null;
    }
    return {
      externalId: item.externalId,
      weightGrams: factors.weightGrams,
      lengthCm: factors.lengthCm,
      widthCm: factors.widthCm,
      heightCm: factors.heightCm,
      boxTypeId: factors.boxTypeId,
      isFragile: factors.isFragile === true,
      declaredValueIrr: lineValueIrr(item, rate),
    };
  }).filter(Boolean);
}

/**
 * یک مرسولهٔ تجمیعی برای کل سبد فیزیکی: وزن و ارزش جمع اقلام، جعبه طبق shipmentBoxTypeId
 * (ابعاد از جدول postexBoxes) و شکنندگی اگر یکی از اقلام شکننده باشد.
 * @returns {{ weightGrams: number, lengthCm: number, widthCm: number, heightCm: number, boxTypeId: number, isFragile: boolean, totalValueIrr: number }}
 */
function cartParcel(physicalItems, rate) {
  let weightGrams = 0;
  let totalValueIrr = 0;
  let baseBoxTypeId = 0;
  let unitCount = 0;
  let isFragile = false;

  for (const item of physicalItems) {
    const factors = requireParcelFactors(item);
    weightGrams += factors.weightGrams;
    totalValueIrr += lineValueIrr(item, rate);
    baseBoxTypeId = Math.max(baseBoxTypeId, factors.boxTypeId);
    unitCount += Number(item.quantity);
    isFragile = isFragile || factors.isFragile;
  }

  if (!Number.isSafeInteger(weightGrams) || weightGrams < 1) {
    conflict('وزن کالای فیزیکی برای ارسال ثبت نشده است.');
  }

  const boxTypeId = postexBoxes.shipmentBoxTypeId(baseBoxTypeId, unitCount);
  const box = postexBoxes.resolve(boxTypeId);
  if (!box) {
    conflict('جعبهٔ کالا تعیین نشده');
  }

  return {
    weightGrams,
    lengthCm: box.lengthCm,
    widthCm: box.widthCm,
    heightCm: box.heightCm,
    boxTypeId: box.id,
    isFragile,
    totalValueIrr,
  };
}

function acceptedQuoteIrr(value) {
  const totalIrr = Number(value);
  if (!Number.isSafeInteger(totalIrr) || totalIrr < 0) {
    conflict('مبلغ برآورد ارسال معتبر نیست.');
  }
  return totalIrr;
}

async function requestPostexTotal(strapi, parcel, addressSnapshot, overrides) {
  if (!postexQuote.isConfigured(overrides)) {
    conflict('برآورد هزینهٔ ارسال از پستکس ممکن نیست؛ کلید دسترسی تنظیم نشده است.');
  }

  const fromCityId = Number(overrides.fromCityId);
  if (!Number.isSafeInteger(fromCityId) || fromCityId < 1) {
    conflict('مبدأ ارسال برای برآورد پستکس معتبر نیست.');
  }

  const toCityCode = await localities.carrierCityCode(strapi, {
    cityDocumentId: addressSnapshot?.cityDocumentId,
  });
  if (toCityCode == null) {
    conflict('شهر گیرنده در جدول محل یافت نشد.');
  }

  assertParcelValueCap(parcel.totalValueIrr);

  try {
    return await postexQuote.quoteParcelCostIrr(
      {
        toCityCode,
        parcelValueIrr: parcel.totalValueIrr,
        weightGrams: parcel.weightGrams,
        lengthCm: parcel.lengthCm,
        widthCm: parcel.widthCm,
        heightCm: parcel.heightCm,
        boxTypeId: parcel.boxTypeId,
        isFragile: parcel.isFragile,
      },
      overrides,
    );
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
    conflict(`برآورد هزینهٔ ارسال از پستکس ممکن نیست.${detail}`);
  }
}

function withCollectionType(overrides, settings) {
  return {
    ...overrides,
    collectionType: shippingCollection.normalizeCollectionType(
      settings?.collectionType ?? overrides?.collectionType,
    ),
    courierCode: shippingCollection.normalizeCourierCode(
      settings?.courierCode ?? overrides?.courierCode,
    ),
    serviceType: shippingCollection.normalizeServiceType(
      settings?.serviceType ?? overrides?.serviceType,
    ),
  };
}

async function postexTotalIrr(strapi, physicalItems, addressSnapshot, overrides = {}) {
  const settings = await strapi.db.query('api::shipping-setting.shipping-setting').findOne({});
  const rate = shippingRate(settings);
  const parcel = cartParcel(physicalItems, rate);
  const quoted = await requestPostexTotal(
    strapi, parcel, addressSnapshot, withCollectionType(overrides, settings),
  );
  return quoted.totalIrr;
}

async function calculatePostex(strapi, settings, subtotal, addressSnapshot, physicalItems, overrides = {}) {
  const threshold = settings?.freeShippingThresholdInNoor;
  assertThreshold(threshold);

  const rate = shippingRate(settings);
  const parcel = cartParcel(physicalItems, rate);

  if (threshold != null && subtotal >= Number(threshold)) {
    return {
      shippingAmountInNoor: 0,
      shippingRuleLabel: 'ارسال رایگان',
      parcelQuotes: attachDeclaredValues(physicalItems, rate),
    };
  }

  assertParcelValueCap(parcel.totalValueIrr);

  const quoteOverrides = withCollectionType(overrides, settings);
  const totalIrr = overrides.quotedTotalIrr != null
    ? acceptedQuoteIrr(overrides.quotedTotalIrr)
    : (await requestPostexTotal(strapi, parcel, addressSnapshot, quoteOverrides)).totalIrr;

  const amount = rialToWholeNoor(totalIrr, rate);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    conflict('مبلغ برآورد ارسال معتبر نیست.');
  }

  return {
    shippingAmountInNoor: amount,
    shippingRuleLabel: 'برآورد پستکس',
    parcelQuotes: attachDeclaredValues(physicalItems, rate),
  };
}

async function calculate(strapi, items, addressSnapshot, overrides = {}) {
  const physicalItems = items.filter((item) => item.type === 'product');
  if (physicalItems.length === 0) {
    return { shippingAmountInNoor: 0, shippingRuleLabel: 'بدون ارسال', parcelQuotes: [] };
  }
  if (!addressSnapshot) {
    conflict('آدرس ارسال معتبر نیست.');
  }

  const settings = await strapi.db.query('api::shipping-setting.shipping-setting').findOne({});
  const subtotal = physicalSubtotal(physicalItems);
  const mode = readMode(settings);

  if (mode === MODE_POSTEX) {
    return calculatePostex(strapi, settings, subtotal, addressSnapshot, physicalItems, overrides);
  }
  return calculateFixed(settings, subtotal, physicalItems);
}

module.exports = {
  calculate,
  readParcelFactors,
  requireProductParcelOrConflict,
  readMode,
  shippingStamp,
  postexTotalIrr,
  MODE_FIXED,
  MODE_POSTEX,
};

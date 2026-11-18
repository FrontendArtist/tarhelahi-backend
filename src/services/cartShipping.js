'use strict';

const { conflict } = require('./stockReservation');
const postexQuote = require('./postexShippingQuote');
const localities = require('./localities');
const postexBoxes = require('./postexBoxes');

const MODE_FIXED = 'fixed';
const MODE_POSTEX = 'postex';
const DEFAULT_RIAL_PER_NOOR = 10_000;

function readMode(settings) {
  return settings?.costMode === MODE_POSTEX ? MODE_POSTEX : MODE_FIXED;
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

/** نبود جعبه پیام جدا دارد؛ وزن ناقص پیام خودش را دارد. */
function requireProductParcelOrConflict(product, quantity) {
  if (!postexBoxes.resolve(product?.boxTypeId)) {
    conflict('جعبهٔ کالا تعیین نشده');
  }
  const factors = readParcelFactors(product, quantity);
  if (!factors) {
    conflict('وزن کالای فیزیکی برای ارسال ثبت نشده است.');
  }
  return factors;
}

function requireParcelFactors(item) {
  const factors = item.parcelFactors;
  if (!factors || !Number.isSafeInteger(factors.boxTypeId) || factors.boxTypeId < 1) {
    conflict('جعبهٔ کالا تعیین نشده');
  }
  if (!Number.isSafeInteger(factors.weightGrams) || factors.weightGrams < 1
    || !Number.isSafeInteger(factors.lengthCm) || factors.lengthCm < 1
    || !Number.isSafeInteger(factors.widthCm) || factors.widthCm < 1
    || !Number.isSafeInteger(factors.heightCm) || factors.heightCm < 1) {
    conflict('وزن کالای فیزیکی برای ارسال ثبت نشده است.');
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

function lineValueIrr(item, rate) {
  const noor = Number(item.discountedUnitPriceInNoor) * Number(item.quantity);
  const value = Math.round(noor * Number(rate));
  if (!Number.isSafeInteger(value) || value < 1) {
    conflict('ارزش ریالی قلم برای برآورد پستکس معتبر نیست.');
  }
  return value;
}

async function calculateFixed(settings, subtotal, physicalItems) {
  const fixedAmount = settings?.fixedAmountInNoor;
  if (fixedAmount == null || !Number.isSafeInteger(Number(fixedAmount)) || Number(fixedAmount) < 0) {
    conflict('خرید کالای فیزیکی تا تنظیم مبلغ ارسال فعال نیست.');
  }
  const threshold = settings?.freeShippingThresholdInNoor;
  assertThreshold(threshold);
  const rate = settings?.rialPerNoorForShipping != null
    ? settings.rialPerNoorForShipping
    : DEFAULT_RIAL_PER_NOOR;
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

async function calculatePostex(strapi, settings, subtotal, addressSnapshot, physicalItems, overrides = {}) {
  const threshold = settings?.freeShippingThresholdInNoor;
  assertThreshold(threshold);

  const rate = settings?.rialPerNoorForShipping != null
    ? settings.rialPerNoorForShipping
    : DEFAULT_RIAL_PER_NOOR;

  for (const item of physicalItems) {
    requireParcelFactors(item);
  }

  if (threshold != null && subtotal >= Number(threshold)) {
    return {
      shippingAmountInNoor: 0,
      shippingRuleLabel: 'ارسال رایگان',
      parcelQuotes: attachDeclaredValues(physicalItems, rate),
    };
  }

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

  let totalIrr = 0;
  const parcelQuotes = [];
  for (const item of physicalItems) {
    const factors = requireParcelFactors(item);
    const actualValue = lineValueIrr(item, rate);
    let quoted;
    try {
      quoted = await postexQuote.quoteParcelCostIrr(
        {
          toCityCode,
          parcelValueIrr: actualValue,
          weightGrams: factors.weightGrams,
          lengthCm: factors.lengthCm,
          widthCm: factors.widthCm,
          heightCm: factors.heightCm,
          boxTypeId: factors.boxTypeId,
          isFragile: factors.isFragile,
          customParcelId: `item-${item.externalId}`,
        },
        overrides,
      );
    } catch (error) {
      const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
      conflict(`برآورد هزینهٔ ارسال از پستکس ممکن نیست.${detail}`);
    }
    totalIrr += quoted.totalIrr;
    parcelQuotes.push({
      externalId: item.externalId,
      weightGrams: factors.weightGrams,
      lengthCm: factors.lengthCm,
      widthCm: factors.widthCm,
      heightCm: factors.heightCm,
      boxTypeId: factors.boxTypeId,
      isFragile: factors.isFragile,
      declaredValueIrr: quoted.declaredValueIrr,
    });
  }

  if (!Number.isSafeInteger(totalIrr) || totalIrr < 0) {
    conflict('مبلغ برآورد ارسال معتبر نیست.');
  }

  const amount = rialToWholeNoor(totalIrr, rate);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    conflict('مبلغ برآورد ارسال معتبر نیست.');
  }
  return { shippingAmountInNoor: amount, shippingRuleLabel: 'برآورد پستکس', parcelQuotes };
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
  MODE_FIXED,
  MODE_POSTEX,
  DEFAULT_RIAL_PER_NOOR,
};

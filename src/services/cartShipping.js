'use strict';

const { conflict } = require('./stockReservation');
const postexQuote = require('./postexShippingQuote');
const localities = require('./localities');

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

async function calculateFixed(settings, subtotal) {
  const fixedAmount = settings?.fixedAmountInNoor;
  if (fixedAmount == null || !Number.isSafeInteger(Number(fixedAmount)) || Number(fixedAmount) < 0) {
    conflict('خرید کالای فیزیکی تا تنظیم مبلغ ارسال فعال نیست.');
  }
  const threshold = settings?.freeShippingThresholdInNoor;
  assertThreshold(threshold);
  if (threshold != null && subtotal >= Number(threshold)) {
    return { shippingAmountInNoor: 0, shippingRuleLabel: 'ارسال رایگان' };
  }
  return { shippingAmountInNoor: Number(fixedAmount), shippingRuleLabel: 'ارسال ثابت داخلی' };
}

async function calculatePostex(strapi, settings, subtotal, addressSnapshot, overrides = {}) {
  const threshold = settings?.freeShippingThresholdInNoor;
  assertThreshold(threshold);
  if (threshold != null && subtotal >= Number(threshold)) {
    return { shippingAmountInNoor: 0, shippingRuleLabel: 'ارسال رایگان' };
  }

  if (!postexQuote.isConfigured(overrides)) {
    conflict('برآورد هزینهٔ ارسال از پستکس ممکن نیست؛ کلید دسترسی تنظیم نشده است.');
  }

  const fromCityId = Number(overrides.fromCityId);
  if (!Number.isSafeInteger(fromCityId) || fromCityId < 1) {
    conflict('مبدأ ارسال برای برآورد پستکس معتبر نیست.');
  }

  const rate = settings?.rialPerNoorForShipping != null
    ? settings.rialPerNoorForShipping
    : DEFAULT_RIAL_PER_NOOR;
  // ارزش اظهارشده ≈ جمع نور کالا × نرخ؛ کف پیش‌فرض عملیاتی پستکس (۵۰ میلیون ریال).
  const parcelValueIrr = Math.max(50_000_000, Math.round(subtotal * Number(rate)));

  const toCityCode = await localities.carrierCityCode(strapi, {
    cityDocumentId: addressSnapshot?.cityDocumentId,
  });
  if (toCityCode == null) {
    conflict('شهر گیرنده در جدول محل یافت نشد.');
  }

  let totalIrr;
  try {
    totalIrr = await postexQuote.quoteTotalCostIrr(
      { toCityCode, parcelValueIrr },
      overrides,
    );
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
    conflict(`برآورد هزینهٔ ارسال از پستکس ممکن نیست.${detail}`);
  }

  const amount = rialToWholeNoor(totalIrr, rate);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    conflict('مبلغ برآورد ارسال معتبر نیست.');
  }
  return { shippingAmountInNoor: amount, shippingRuleLabel: 'برآورد پستکس' };
}

async function calculate(strapi, items, addressSnapshot, overrides = {}) {
  const physicalItems = items.filter((item) => item.type === 'product');
  if (physicalItems.length === 0) {
    return { shippingAmountInNoor: 0, shippingRuleLabel: 'بدون ارسال' };
  }
  if (!addressSnapshot) {
    conflict('آدرس ارسال معتبر نیست.');
  }

  const settings = await strapi.db.query('api::shipping-setting.shipping-setting').findOne({});
  const subtotal = physicalSubtotal(physicalItems);
  const mode = readMode(settings);

  if (mode === MODE_POSTEX) {
    return calculatePostex(strapi, settings, subtotal, addressSnapshot, overrides);
  }
  return calculateFixed(settings, subtotal);
}

module.exports = {
  calculate,
  MODE_FIXED,
  MODE_POSTEX,
  DEFAULT_RIAL_PER_NOOR,
};

'use strict';

const { conflict } = require('./stockReservation');

async function calculate(strapi, items, addressSnapshot) {
  const physicalItems = items.filter((item) => item.type === 'product');
  if (physicalItems.length === 0) {
    return { shippingAmountInNoor: 0, shippingRuleLabel: 'بدون ارسال' };
  }
  if (!addressSnapshot) {
    conflict('آدرس ارسال معتبر نیست.');
  }
  const settings = await strapi.db.query('api::shipping-setting.shipping-setting').findOne({});
  const fixedAmount = settings?.fixedAmountInNoor;
  const threshold = settings?.freeShippingThresholdInNoor;
  if (fixedAmount == null || !Number.isSafeInteger(Number(fixedAmount)) || Number(fixedAmount) < 0) {
    conflict('خرید کالای فیزیکی تا تنظیم مبلغ ارسال فعال نیست.');
  }
  if (threshold != null && (!Number.isSafeInteger(Number(threshold)) || Number(threshold) < 0)) {
    conflict('آستانهٔ ارسال رایگان معتبر نیست.');
  }
  // فقط کالا، پس از تخفیف خود کالا و قبل از کوپن؛ وزن در محاسبه مصرف نمی‌شود.
  const subtotal = physicalItems.reduce((sum, item) => sum + item.discountedUnitPriceInNoor * item.quantity, 0);
  if (threshold != null && subtotal >= Number(threshold)) {
    return { shippingAmountInNoor: 0, shippingRuleLabel: 'ارسال رایگان' };
  }
  return { shippingAmountInNoor: Number(fixedAmount), shippingRuleLabel: 'ارسال ثابت داخلی' };
}

module.exports = { calculate };

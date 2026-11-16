'use strict';

/**
 * مبدأ ارسال مشترک استرپی/بای‌مانی (SHIP-MULTI-ORIGIN).
 * شناسهٔ پایدار (مثلاً ramsar) روی کالا و پاسخ prepare می‌آید؛ cityId فقط برای quote پستکس است.
 */

const { conflict } = require('./stockReservation');

const UID = 'api::shipping-origin.shipping-origin';
const DEFAULT_ORIGIN_ID = 'ramsar';

function normalizeOrigin(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const originId = typeof raw.originId === 'string' ? raw.originId.trim() : '';
  const cityId = Number(raw.cityId);
  if (!originId || !Number.isSafeInteger(cityId) || cityId < 1) {
    return null;
  }
  const displayName = typeof raw.displayName === 'string' && raw.displayName.trim()
    ? raw.displayName.trim()
    : originId;
  const cityName = typeof raw.cityName === 'string' ? raw.cityName.trim() : '';
  return { originId, displayName, cityId, cityName };
}

/**
 * مبدأ واحد سبد فیزیکی را از رکوردهای محصول resolve می‌کند.
 * نبود مبدأ یا چند مبدأ متفاوت → CART_CONFLICT.
 */
function resolveCartOrigin(productRecords) {
  if (!Array.isArray(productRecords) || productRecords.length === 0) {
    return null;
  }

  const origins = [];
  for (const record of productRecords) {
    const origin = normalizeOrigin(record?.shippingOrigin);
    if (!origin) {
      conflict('مبدأ ارسال کالای فیزیکی تنظیم نشده است.');
    }
    origins.push(origin);
  }

  const ids = new Set(origins.map((item) => item.originId));
  if (ids.size > 1) {
    conflict('اقلام فیزیکی سبد باید از یک مبدأ ارسال باشند.');
  }

  return origins[0];
}

/** ایجاد مبدأ پیش‌فرض رامسر در صورت نبود (فقط bootstrap). */
async function ensureDefaultOrigin(strapi) {
  const existing = await strapi.db.query(UID).findOne({
    where: { originId: DEFAULT_ORIGIN_ID },
  });
  if (existing) {
    return existing;
  }

  return strapi.db.query(UID).create({
    data: {
      originId: DEFAULT_ORIGIN_ID,
      displayName: 'رامسر',
      cityId: 573,
      cityName: 'رامسر',
    },
  });
}

module.exports = {
  UID,
  DEFAULT_ORIGIN_ID,
  normalizeOrigin,
  resolveCartOrigin,
  ensureDefaultOrigin,
};

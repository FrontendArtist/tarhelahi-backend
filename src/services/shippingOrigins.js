'use strict';

/**
 * مبدأ ارسال مشترک استرپی/بای‌مانی (SHIP-MULTI-ORIGIN).
 * شناسهٔ پایدار (مثلاً ramsar) روی کالا و پاسخ prepare می‌آید؛
 * شناسهٔ محل برای quote از city.externalId خوانده می‌شود (نه اسنپ‌شات روی مبدأ).
 * کالای بدون مبدأ، مبدأ ناقص، یا چند مبدأ متفاوت → CART_CONFLICT.
 * رامسر فقط مبدأ قابل‌انتخاب است و دیگر جایگزین خاموش کالای بی‌مبدأ نیست.
 */

const { conflict } = require('./stockReservation');
const postexLocality = require('./postexLocalitySync');

const UID = 'api::shipping-origin.shipping-origin';
const DEFAULT_ORIGIN_ID = 'ramsar';
const FALLBACK_RAMSAR = Object.freeze({
  originId: DEFAULT_ORIGIN_ID,
  displayName: 'رامسر',
  cityId: postexLocality.RAMSAR_CITY_ID,
  cityName: postexLocality.RAMSAR_CITY_NAME,
});

function normalizeOrigin(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const originId = typeof raw.originId === 'string' ? raw.originId.trim() : '';
  if (!originId) {
    return null;
  }

  const city = raw.city;
  let cityId = null;
  let cityName = '';
  if (city && typeof city === 'object') {
    const fromCity = Number(city.externalId);
    if (Number.isSafeInteger(fromCity) && fromCity >= 1) {
      cityId = fromCity;
    }
    if (typeof city.name === 'string' && city.name.trim()) {
      cityName = city.name.trim();
    }
  }

  // سازگاری موقت با شکل درحافظه/آزمون که city را مستقیم می‌دهد
  if (cityId == null && Number.isSafeInteger(Number(raw.cityId)) && Number(raw.cityId) >= 1) {
    cityId = Number(raw.cityId);
    if (typeof raw.cityName === 'string') {
      cityName = raw.cityName.trim();
    }
  }

  if (!Number.isSafeInteger(cityId) || cityId < 1) {
    return null;
  }

  const displayName = typeof raw.displayName === 'string' && raw.displayName.trim()
    ? raw.displayName.trim()
    : originId;
  return { originId, displayName, cityId, cityName };
}

const MISSING_ORIGIN_MESSAGE = 'مبدأ ارسال کالای فیزیکی تعیین نشده است.';

/**
 * مبدأ واحد سبد فیزیکی را از رکوردهای محصول resolve می‌کند.
 * نبود مبدأ، مبدأ ناقص، یا چند مبدأ متفاوت → CART_CONFLICT.
 */
function resolveCartOrigin(productRecords) {
  if (!Array.isArray(productRecords) || productRecords.length === 0) {
    return null;
  }

  const origins = [];
  for (const record of productRecords) {
    const raw = record?.shippingOrigin;
    if (raw == null) {
      conflict(MISSING_ORIGIN_MESSAGE);
    }
    const origin = normalizeOrigin(raw);
    if (!origin) {
      conflict('مبدأ ارسال کالای فیزیکی ناقص است.');
    }
    origins.push(origin);
  }

  const ids = new Set(origins.map((item) => item.originId));
  if (ids.size > 1) {
    conflict('اقلام فیزیکی سبد باید از یک مبدأ ارسال باشند.');
  }

  return origins[0];
}

async function loadDefaultOrigin(strapi) {
  try {
    const existing = await strapi.db.query(UID).findOne({
      where: { originId: DEFAULT_ORIGIN_ID },
      populate: { city: true },
    });
    return normalizeOrigin(existing) || { ...FALLBACK_RAMSAR };
  } catch {
    return { ...FALLBACK_RAMSAR };
  }
}

/** ایجاد مبدأ پیش‌فرض رامسر در صورت نبود (فقط bootstrap). */
async function ensureDefaultOrigin(strapi) {
  const city = await postexLocality.ensureRamsarCity(strapi);
  const existing = await strapi.db.query(UID).findOne({
    where: { originId: DEFAULT_ORIGIN_ID },
    populate: { city: true },
  });

  if (existing) {
    const linkedId = existing.city?.id ?? existing.city;
    if (linkedId !== city.id) {
      return strapi.db.query(UID).update({
        where: { id: existing.id },
        data: {
          city: city.id,
          displayName: existing.displayName || FALLBACK_RAMSAR.displayName,
        },
      });
    }
    return existing;
  }

  return strapi.db.query(UID).create({
    data: {
      originId: DEFAULT_ORIGIN_ID,
      displayName: FALLBACK_RAMSAR.displayName,
      city: city.id,
    },
  });
}

module.exports = {
  UID,
  DEFAULT_ORIGIN_ID,
  FALLBACK_RAMSAR,
  MISSING_ORIGIN_MESSAGE,
  normalizeOrigin,
  resolveCartOrigin,
  loadDefaultOrigin,
  ensureDefaultOrigin,
};

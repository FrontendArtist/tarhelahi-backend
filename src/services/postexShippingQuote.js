'use strict';

/**
 * استعلام هزینهٔ ارسال از پستکس برای سبد فیزیکی (SHIP-COST-MODE).
 * نگاشت شهر از cities/all؛ مبدأ پیش‌فرض رامسر (city_id=573) تا SHIP-MULTI-ORIGIN.
 */

const DEFAULT_BASE_URL = 'https://api.postex.ir';
const DEFAULT_FROM_CITY_ID = 573; // رامسر — هم‌راستا با Postex:Sender در بای‌مانی
const DEFAULT_COURIER = 'IR_POST';
const DEFAULT_SERVICE_TYPE = 'EXPRESS';
const DEFAULT_BOX_TYPE_ID = 5;
const DEFAULT_WEIGHT_GRAMS = 250;
const DEFAULT_PARCEL_VALUE_IRR = 50_000_000;
const DEFAULT_TIMEOUT_MS = 12_000;

let cityCache = null;
let cityCachePromise = null;

function normalizeName(value) {
  return String(value || '')
    .trim()
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\s+/g, '');
}

function configFromEnv(overrides = {}) {
  const apiKey = overrides.apiKey ?? process.env.POSTEX_API_KEY ?? '';
  const baseUrl = String(overrides.baseUrl ?? process.env.POSTEX_BASE_URL ?? DEFAULT_BASE_URL)
    .replace(/\/+$/, '');
  return {
    apiKey: String(apiKey).trim(),
    baseUrl,
    fromCityId: Number(overrides.fromCityId) || DEFAULT_FROM_CITY_ID,
    courierCode: overrides.courierCode || DEFAULT_COURIER,
    serviceType: overrides.serviceType || DEFAULT_SERVICE_TYPE,
    boxTypeId: Number(overrides.boxTypeId) || DEFAULT_BOX_TYPE_ID,
    weightGrams: Number(overrides.weightGrams) || DEFAULT_WEIGHT_GRAMS,
    parcelValueIrr: Number(overrides.parcelValueIrr) || DEFAULT_PARCEL_VALUE_IRR,
    collectionType: overrides.collectionType || 'pick_up',
    timeoutMs: Number(overrides.timeoutMs) || DEFAULT_TIMEOUT_MS,
    fetchImpl: overrides.fetchImpl || globalThis.fetch,
  };
}

function isConfigured(overrides = {}) {
  return Boolean(configFromEnv(overrides).apiKey);
}

async function loadCityMap(cfg) {
  if (cityCache) {
    return cityCache;
  }
  if (cityCachePromise) {
    return cityCachePromise;
  }

  cityCachePromise = (async () => {
    const response = await fetchWithTimeout(
      cfg,
      `${cfg.baseUrl}/api/v1/locality/cities/all`,
      { method: 'GET' },
    );
    if (!response.ok) {
      throw new Error(`دریافت فهرست شهرهای پستکس ناموفق بود (${response.status}).`);
    }
    const body = await response.json();
    if (!Array.isArray(body)) {
      throw new Error('پاسخ فهرست شهرهای پستکس نامعتبر است.');
    }

    const map = new Map();
    for (const province of body) {
      const cities = province?.cities;
      if (!Array.isArray(cities)) {
        continue;
      }
      for (const city of cities) {
        const name = normalizeName(city?.name);
        const id = Number(city?.id);
        if (name && Number.isSafeInteger(id) && id > 0) {
          map.set(name, id);
        }
      }
    }
    cityCache = map;
    return map;
  })();

  try {
    return await cityCachePromise;
  } finally {
    cityCachePromise = null;
  }
}

async function resolveCityId(cityName, provinceName, cfg) {
  const map = await loadCityMap(cfg);
  const cityKey = normalizeName(cityName);
  if (!cityKey) {
    return null;
  }
  if (map.has(cityKey)) {
    return map.get(cityKey);
  }

  for (const [name, id] of map.entries()) {
    if (name.startsWith(cityKey) || cityKey.startsWith(name)) {
      return id;
    }
  }

  void provinceName;
  return null;
}

async function fetchWithTimeout(cfg, url, init) {
  const fetchImpl = cfg.fetchImpl;
  if (typeof fetchImpl !== 'function') {
    throw new Error('فراخوانی HTTP برای پستکس در دسترس نیست.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(cfg.apiKey ? { 'x-api-key': cfg.apiKey } : {}),
        ...(init.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @returns {Promise<number>} total_cost به ریال (صحیح)
 */
async function quoteTotalCostIrr({ cityName, provinceName, parcelValueIrr, weightGrams }, overrides = {}) {
  const cfg = configFromEnv(overrides);
  if (!cfg.apiKey) {
    throw new Error('کلید دسترسی پستکس تنظیم نشده است.');
  }

  const toCityId = await resolveCityId(cityName, provinceName, cfg);
  if (toCityId == null) {
    throw new Error(`شهر گیرنده «${cityName || 'نامشخص'}» در فهرست پستکس یافت نشد.`);
  }

  const value = Number.isSafeInteger(Number(parcelValueIrr)) && Number(parcelValueIrr) > 0
    ? Number(parcelValueIrr)
    : cfg.parcelValueIrr;
  const weight = Number.isSafeInteger(Number(weightGrams)) && Number(weightGrams) > 0
    ? Number(weightGrams)
    : cfg.weightGrams;

  const body = {
    collection_type: cfg.collectionType,
    from_city_code: cfg.fromCityId,
    courier: {
      courier_code: cfg.courierCode,
      service_type: cfg.serviceType,
    },
    parcels: [
      {
        custom_parcel_id: 'cart-shipping',
        to_city_code: toCityId,
        payment_type: 'SENDER',
        parcel_properties: {
          length: 15,
          width: 10,
          height: 5,
          total_weight: weight,
          is_fragile: false,
          is_liquid: false,
          total_value: value,
          pre_paid_amount: 0,
          total_value_currency: 'IRR',
          box_type_id: cfg.boxTypeId,
        },
      },
    ],
    value_added_service: {
      request_label: false,
      request_packaging: false,
      request_sms_notification: false,
    },
  };

  const response = await fetchWithTimeout(cfg, `${cfg.baseUrl}/api/v1/shipping/quotes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`پاسخ نامعتبر پستکس (${response.status}).`);
  }

  if (!response.ok) {
    const message = payload?.message || payload?.Message || `استعلام هزینهٔ پستکس ناموفق بود (${response.status}).`;
    throw new Error(message);
  }

  const total = Number(payload?.total_cost);
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error('مبلغ برآورد پستکس نامعتبر است.');
  }
  return total;
}

/** فقط برای آزمون. */
function resetCityCacheForTests() {
  cityCache = null;
  cityCachePromise = null;
}

module.exports = {
  isConfigured,
  quoteTotalCostIrr,
  resolveCityId,
  normalizeName,
  resetCityCacheForTests,
  DEFAULT_FROM_CITY_ID,
  DEFAULT_COURIER,
  DEFAULT_SERVICE_TYPE,
};

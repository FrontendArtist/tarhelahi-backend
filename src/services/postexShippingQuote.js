'use strict';

/**
 * استعلام هزینهٔ ارسال از پستکس برای سبد فیزیکی (SHIP-COST-MODE / SHIP-PARCEL-FACTORS).
 * نگاشت شهر از cities/all؛ from_city از مبدأ کالای سبد می‌آید (نه ثابت اپ).
 * وزن، ابعاد، box_type_id و ارزش از عوامل فریزشدنی کالا می‌آید (ابعاد از جعبهٔ استاندارد).
 */

const { createHash } = require('node:crypto');

const DEFAULT_BASE_URL = 'https://api.postex.ir';
/** فقط برای آزمون‌های قدیمی؛ مسیر زنده باید fromCityId مبدأ کالا را بدهد. */
const DEFAULT_FROM_CITY_ID = 573;
const DEFAULT_COURIER = 'IR_POST';
const DEFAULT_SERVICE_TYPE = 'EXPRESS';
const DEFAULT_TIMEOUT_MS = 12_000;
const VALUE_FLOOR_IRR = 50_000_000;

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
    collectionType: overrides.collectionType || 'pick_up',
    timeoutMs: Number(overrides.timeoutMs) || DEFAULT_TIMEOUT_MS,
    fetchImpl: overrides.fetchImpl || globalThis.fetch,
  };
}

function isConfigured(overrides = {}) {
  return Boolean(configFromEnv(overrides).apiKey);
}

/**
 * اثرانگشت راه‌اندازی پستکس. فقط در bootstrap لاگ می‌شود و روی هیچ مسیر HTTP نیست.
 * مادهٔ هش: normalizedBaseUrl + "|" + apiKey. اسلش‌های انتهای نشانی حذف می‌شوند.
 * کلید خالی هش نمی‌شود.
 */
function logConfigFingerprint(strapi, overrides = {}) {
  const { apiKey, baseUrl } = configFromEnv(overrides);
  const log = strapi?.log;
  if (!apiKey) {
    log?.warn?.('[Postex] API key is not configured.');
    return null;
  }
  const fingerprint = createHash('sha256').update(`${baseUrl}|${apiKey}`).digest('hex');
  log?.info?.(`[Postex] config fingerprint: ${fingerprint}`);
  return fingerprint;
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

function collectFieldErrors(node, path, out) {
  if (node == null) {
    return;
  }
  if (typeof node === 'string') {
    const text = node.trim();
    if (text) {
      out.push(path ? `${path}: ${text}` : text);
    }
    return;
  }
  if (Array.isArray(node)) {
    if (node.every((entry) => typeof entry === 'string')) {
      const joined = node.map((entry) => String(entry).trim()).filter(Boolean).join('؛ ');
      if (joined) {
        out.push(path ? `${path}: ${joined}` : joined);
      }
      return;
    }
    node.forEach((entry, index) => {
      collectFieldErrors(entry, path ? `${path}[${index}]` : `[${index}]`, out);
    });
    return;
  }
  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      const next = path ? `${path}.${key}` : key;
      collectFieldErrors(value, next, out);
    }
  }
}

function extractErrorMessage(payload, status) {
  if (payload && typeof payload === 'object') {
    const parts = [];
    const title = payload.message || payload.Message || payload.title;
    if (typeof title === 'string' && title.trim()) {
      parts.push(title.trim());
    }
    collectFieldErrors(payload.errors, '', parts);
    collectFieldErrors(payload.invalid_fields, 'invalid_fields', parts);
    if (parts.length > 0) {
      return parts.join(' | ');
    }
  }
  return `استعلام هزینهٔ پستکس ناموفق بود (${status}).`;
}

function assertPositiveInt(name, value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${name} مرسوله معتبر نیست.`);
  }
  return number;
}

/**
 * @returns {Promise<number>} total_cost به ریال (صحیح)
 */
async function quoteTotalCostIrr(input, overrides = {}) {
  const cfg = configFromEnv(overrides);
  if (!cfg.apiKey) {
    throw new Error('کلید دسترسی پستکس تنظیم نشده است.');
  }

  let toCityId;
  if (input.toCityCode != null) {
    const direct = Number(input.toCityCode);
    if (!Number.isSafeInteger(direct) || direct < 1) {
      throw new Error('شناسهٔ محل گیرنده معتبر نیست.');
    }
    toCityId = direct;
  } else {
    toCityId = await resolveCityId(input.cityName, input.provinceName, cfg);
    if (toCityId == null) {
      throw new Error(`شهر گیرنده «${input.cityName || 'نامشخص'}» در فهرست پستکس یافت نشد.`);
    }
  }

  const weight = assertPositiveInt('وزن', input.weightGrams);
  const length = assertPositiveInt('طول', input.lengthCm);
  const width = assertPositiveInt('عرض', input.widthCm);
  const height = assertPositiveInt('ارتفاع', input.heightCm);
  const boxTypeId = assertPositiveInt('جعبه', input.boxTypeId);
  const value = assertPositiveInt('ارزش', input.parcelValueIrr);
  const isFragile = input.isFragile === true;

  const body = {
    collection_type: cfg.collectionType,
    from_city_code: cfg.fromCityId,
    courier: {
      courier_code: cfg.courierCode,
      service_type: cfg.serviceType,
    },
    parcels: [
      {
        custom_parcel_id: input.customParcelId || 'cart-shipping',
        to_city_code: toCityId,
        payment_type: 'SENDER',
        parcel_properties: {
          box_type_id: boxTypeId,
          length,
          width,
          height,
          total_weight: weight,
          is_fragile: isFragile,
          is_liquid: false,
          total_value: value,
          pre_paid_amount: 0,
          total_value_currency: 'IRR',
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
    throw new Error(extractErrorMessage(payload, response.status));
  }

  const total = Number(payload?.total_cost);
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error('مبلغ برآورد پستکس نامعتبر است.');
  }
  return total;
}

/**
 * ارزش واقعی را می‌فرستد؛ فقط اگر پستکس رد کرد و ارزش زیر کف بود، با کف ۵۰ میلیون تکرار می‌کند.
 * @returns {Promise<{ totalIrr: number, declaredValueIrr: number }>}
 */
async function quoteParcelCostIrr(input, overrides = {}) {
  const actual = assertPositiveInt('ارزش', input.parcelValueIrr);
  try {
    const totalIrr = await quoteTotalCostIrr({ ...input, parcelValueIrr: actual }, overrides);
    return { totalIrr, declaredValueIrr: actual };
  } catch (firstError) {
    if (actual >= VALUE_FLOOR_IRR) {
      throw firstError;
    }
    try {
      const totalIrr = await quoteTotalCostIrr(
        { ...input, parcelValueIrr: VALUE_FLOOR_IRR },
        overrides,
      );
      return { totalIrr, declaredValueIrr: VALUE_FLOOR_IRR };
    } catch {
      throw firstError;
    }
  }
}

/** فقط برای آزمون. */
function resetCityCacheForTests() {
  cityCache = null;
  cityCachePromise = null;
}

module.exports = {
  isConfigured,
  logConfigFingerprint,
  quoteTotalCostIrr,
  quoteParcelCostIrr,
  resolveCityId,
  normalizeName,
  extractErrorMessage,
  resetCityCacheForTests,
  DEFAULT_FROM_CITY_ID,
  DEFAULT_COURIER,
  DEFAULT_SERVICE_TYPE,
  VALUE_FLOOR_IRR,
};

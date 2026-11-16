'use strict';

/**
 * آداپتور همگام‌سازی استان/شهر از حامل فعلی (پستکس).
 * داده در جدول‌های province/city با فیلد دامنهٔ externalId ذخیره می‌شود؛ کلید در لاگ/پاسخ نمی‌آید.
 */

const DEFAULT_BASE_URL = 'https://api.postex.ir';
const DEFAULT_TIMEOUT_MS = 60_000;
const PROVINCE_UID = 'api::province.province';
const CITY_UID = 'api::city.city';
const RAMSAR_CITY_ID = 573;
const RAMSAR_CITY_NAME = 'رامسر';

function configFromEnv(overrides = {}) {
  const apiKey = overrides.apiKey ?? process.env.POSTEX_API_KEY ?? '';
  const baseUrl = String(overrides.baseUrl ?? process.env.POSTEX_BASE_URL ?? DEFAULT_BASE_URL)
    .replace(/\/+$/, '');
  return {
    apiKey: String(apiKey).trim(),
    baseUrl,
    timeoutMs: Number(overrides.timeoutMs) || DEFAULT_TIMEOUT_MS,
    fetchImpl: overrides.fetchImpl || globalThis.fetch,
  };
}

function isConfigured(overrides = {}) {
  return Boolean(configFromEnv(overrides).apiKey);
}

async function fetchWithTimeout(cfg, url, init) {
  const fetchImpl = cfg.fetchImpl;
  if (typeof fetchImpl !== 'function') {
    throw new Error('فراخوانی HTTP برای همگام‌سازی محل در دسترس نیست.');
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

/** اگر ستون قدیمی postex_id مانده، مقدار را به external_id کپی می‌کند. */
async function migrateLegacyPostexIdColumn(strapi) {
  const knex = strapi?.db?.connection;
  if (!knex?.schema?.hasColumn) {
    return;
  }
  for (const table of ['provinces', 'cities']) {
    try {
      const hasOld = await knex.schema.hasColumn(table, 'postex_id');
      const hasNew = await knex.schema.hasColumn(table, 'external_id');
      if (hasOld && hasNew) {
        await knex.raw(
          `UPDATE ?? SET external_id = postex_id WHERE external_id IS NULL AND postex_id IS NOT NULL`,
          [table],
        );
      }
    } catch {
      // محیط بدون جداول یا بدون دسترسی؛ bootstrap بعداً رامسر را می‌سازد.
    }
  }
}

async function upsertProvince(strapi, externalId, name) {
  const existing = await strapi.db.query(PROVINCE_UID).findOne({ where: { externalId } });
  if (existing) {
    if (existing.name !== name) {
      return strapi.db.query(PROVINCE_UID).update({
        where: { id: existing.id },
        data: { name },
      });
    }
    return existing;
  }
  return strapi.db.query(PROVINCE_UID).create({
    data: { externalId, name },
  });
}

async function upsertCity(strapi, externalId, name, provinceDbId) {
  const existing = await strapi.db.query(CITY_UID).findOne({ where: { externalId } });
  const data = {
    externalId,
    name,
    ...(provinceDbId ? { province: provinceDbId } : {}),
  };
  if (existing) {
    return strapi.db.query(CITY_UID).update({
      where: { id: existing.id },
      data,
    });
  }
  return strapi.db.query(CITY_UID).create({ data });
}

/** ایجاد حداقلی شهر رامسر وقتی همگام‌سازی کامل ممکن نیست. */
async function ensureRamsarCity(strapi) {
  const existing = await strapi.db.query(CITY_UID).findOne({
    where: { externalId: RAMSAR_CITY_ID },
  });
  if (existing) {
    return existing;
  }
  return strapi.db.query(CITY_UID).create({
    data: { externalId: RAMSAR_CITY_ID, name: RAMSAR_CITY_NAME },
  });
}

/**
 * دریافت و upsert فهرست کامل استان/شهر از حامل فعلی.
 * @returns {{ provinces: number, cities: number }}
 */
async function syncFromPostex(strapi, overrides = {}) {
  const cfg = configFromEnv(overrides);
  if (!cfg.apiKey) {
    throw new Error('کلید دسترسی حامل برای همگام‌سازی شهرها تنظیم نشده است.');
  }

  const response = await fetchWithTimeout(cfg, `${cfg.baseUrl}/api/v1/locality/cities/all`, {
    method: 'GET',
  });
  if (!response.ok) {
    throw new Error(`دریافت فهرست شهرها ناموفق بود (${response.status}).`);
  }
  const body = await response.json();
  if (!Array.isArray(body)) {
    throw new Error('پاسخ فهرست شهرها نامعتبر است.');
  }

  let provinceCount = 0;
  let cityCount = 0;
  for (const province of body) {
    const provinceId = Number(province?.id);
    const provinceName = typeof province?.name === 'string' ? province.name.trim() : '';
    if (!Number.isSafeInteger(provinceId) || provinceId < 1 || !provinceName) {
      continue;
    }
    const provinceRow = await upsertProvince(strapi, provinceId, provinceName);
    provinceCount += 1;

    const cities = Array.isArray(province?.cities) ? province.cities : [];
    for (const city of cities) {
      const cityId = Number(city?.id);
      const cityName = typeof city?.name === 'string' ? city.name.trim() : '';
      if (!Number.isSafeInteger(cityId) || cityId < 1 || !cityName) {
        continue;
      }
      await upsertCity(strapi, cityId, cityName, provinceRow.id);
      cityCount += 1;
    }
  }

  return { provinces: provinceCount, cities: cityCount };
}

/**
 * اگر کلید هست و استان‌ها خالی‌اند (حتی با شهر bootstrap مثل رامسر) → همگام کامل؛
 * همیشه رامسر را تضمین می‌کند.
 */
async function ensureLocalityBootstrap(strapi, overrides = {}) {
  await migrateLegacyPostexIdColumn(strapi);
  if (isConfigured(overrides)) {
    const provinceCount = await strapi.db.query(PROVINCE_UID).count();
    if (provinceCount === 0) {
      await syncFromPostex(strapi, overrides);
    }
  }
  return ensureRamsarCity(strapi);
}

module.exports = {
  PROVINCE_UID,
  CITY_UID,
  RAMSAR_CITY_ID,
  RAMSAR_CITY_NAME,
  isConfigured,
  syncFromPostex,
  ensureRamsarCity,
  ensureLocalityBootstrap,
  migrateLegacyPostexIdColumn,
};

'use strict';

const { Pool } = require('pg');
const {
  DEFAULT_COLLECTION_TYPE,
  DEFAULT_COURIER,
  DEFAULT_SERVICE_TYPE,
} = require('./shippingCollection');

let pool = null;
let cachedRate = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 10_000;

function getByeMoneyDbConfig() {
  if (process.env.BYEMONEY_DATABASE_URL) {
    return { connectionString: process.env.BYEMONEY_DATABASE_URL };
  }

  const host = process.env.BYEMONEY_DATABASE_HOST || process.env.DATABASE_HOST || '127.0.0.1';
  const port = Number(process.env.BYEMONEY_DATABASE_PORT || process.env.DATABASE_PORT || 5432);
  const database = process.env.BYEMONEY_DATABASE_NAME || process.env.BYEMONEY_DB_NAME || 'ByeMoney_Dev';
  const user = process.env.BYEMONEY_DATABASE_USERNAME || process.env.DATABASE_USERNAME || 'postgres';
  const password = process.env.BYEMONEY_DATABASE_PASSWORD || process.env.DATABASE_PASSWORD || '123456';
  const ssl = process.env.BYEMONEY_DATABASE_SSL
    ? process.env.BYEMONEY_DATABASE_SSL === 'true'
    : (process.env.DATABASE_SSL === 'true');

  return { host, port, database, user, password, ssl };
}

function getPool(customConfig) {
  if (customConfig) {
    return new Pool(customConfig);
  }
  if (!pool) {
    const config = getByeMoneyDbConfig();
    pool = new Pool({
      ...config,
      max: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 3000,
    });
    pool.on('error', (err) => {
      if (global.strapi?.log?.warn) {
        global.strapi.log.warn(`[ByeMoneySettings] Pool error: ${err.message}`);
      }
    });
  }
  return pool;
}

async function closePool() {
  if (pool) {
    const current = pool;
    pool = null;
    await current.end().catch(() => {});
  }
}

function clearCache() {
  cachedRate = null;
  cacheExpiresAt = 0;
}

/**
 * Fetches the conversion rate directly from ByeMoney database (SystemSettings table).
 */
async function fetchRateFromDatabase(options = {}) {
  const activePool = options.pool || getPool(options.dbConfig);
  const query = 'SELECT "Value" FROM "SystemSettings" WHERE "Key" = $1 LIMIT 1';
  const res = await activePool.query(query, ['ConversionRate:RialToNoor']);
  if (res.rows && res.rows.length > 0 && res.rows[0].Value != null) {
    const rawVal = res.rows[0].Value;
    const rate = Number(rawVal);
    if (Number.isSafeInteger(rate) && rate > 0) {
      return rate;
    }
  }
  return null;
}

/**
 * Fallback to fetch rate from ByeMoney API if available.
 */
async function fetchRateFromApi(options = {}) {
  const baseUrl = options.apiUrl || process.env.BYEMONEY_API_URL || 'http://localhost:5000';
  const timeoutMs = Number(options.timeoutMs || 3000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  try {
    const res = await fetch(`${baseUrl}/api/settings/conversion-rate`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    const rate = Number(data?.rialPerNoor);
    if (Number.isSafeInteger(rate) && rate > 0) {
      return rate;
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Gets the current Rial-to-Noor conversion rate from ByeMoney.
 * Checks memory cache -> ByeMoney DB -> ByeMoney API -> null.
 */
async function getRialToNoorRate(options = {}) {
  const now = Date.now();
  if (!options.forceFresh && cachedRate != null && now < cacheExpiresAt) {
    return cachedRate;
  }

  // 1. Try ByeMoney Database
  try {
    const dbRate = await fetchRateFromDatabase(options);
    if (dbRate != null) {
      cachedRate = dbRate;
      cacheExpiresAt = now + CACHE_TTL_MS;
      return dbRate;
    }
  } catch (err) {
    if (global.strapi?.log?.warn) {
      global.strapi.log.warn(`[ByeMoneySettings] Could not query ByeMoney DB: ${err.message}`);
    }
  }

  // 2. Fallback to ByeMoney API
  try {
    const apiRate = await fetchRateFromApi(options);
    if (apiRate != null) {
      cachedRate = apiRate;
      cacheExpiresAt = now + CACHE_TTL_MS;
      return apiRate;
    }
  } catch (err) {
    if (global.strapi?.log?.warn) {
      global.strapi.log.warn(`[ByeMoneySettings] Could not query ByeMoney API fallback: ${err.message}`);
    }
  }

  // If cache had an older value, return it
  if (cachedRate != null) {
    return cachedRate;
  }

  return null;
}

/**
 * Synchronizes the rate into Strapi's shipping-setting single type.
 */
async function syncShippingSettingRate(strapi, options = {}) {
  if (!strapi?.db?.query) {
    return;
  }

  const rate = await getRialToNoorRate(options);
  if (!rate) {
    return;
  }

  const rateStr = String(rate);
  const uid = 'api::shipping-setting.shipping-setting';
  const existing = await strapi.db.query(uid).findOne({});

  if (existing) {
    if (String(existing.rialPerNoorForShipping) !== rateStr) {
      await strapi.db.query(uid).update({
        where: { id: existing.id },
        data: { rialPerNoorForShipping: rateStr },
      });
      strapi.log?.info?.(`[ShippingSetting] Synced rialPerNoorForShipping from ByeMoney: ${rateStr}`);
    }
  } else {
    await strapi.db.query(uid).create({
      data: {
        costMode: 'fixed',
        collectionType: DEFAULT_COLLECTION_TYPE,
        courierCode: DEFAULT_COURIER,
        serviceType: DEFAULT_SERVICE_TYPE,
        rialPerNoorForShipping: rateStr,
      },
    });
    strapi.log?.info?.(`[ShippingSetting] Created shipping-setting with ByeMoney rate: ${rateStr}`);
  }
}

module.exports = {
  getByeMoneyDbConfig,
  fetchRateFromDatabase,
  fetchRateFromApi,
  getRialToNoorRate,
  syncShippingSettingRate,
  clearCache,
  closePool,
};

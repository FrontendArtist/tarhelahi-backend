'use strict';

/**
 * روش جمع‌آوری سراسری (S1-01). استعلام هزینه و ساخت مرسوله هر دو همین مقدار را می‌خوانند.
 * پیش‌فرض مصوب تحویل توسط خودمان است. مقدار تهی یا خارج از فهرست همان پیش‌فرض است.
 */

const UID = 'api::shipping-setting.shipping-setting';

const PICK_UP = 'pick_up';
const COURIER_DROP_OFF = 'courier_drop_off';
const POSTEX_DROP_OFF = 'postex_drop_off';
const ALLOWED = new Set([PICK_UP, COURIER_DROP_OFF, POSTEX_DROP_OFF]);
const DEFAULT_COLLECTION_TYPE = COURIER_DROP_OFF;
const DEFAULT_COURIER = 'IR_POST';
const DEFAULT_SERVICE_TYPE = 'EXPRESS';
const DISPATCH_TOKEN = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

function normalizeCollectionType(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return ALLOWED.has(text) ? text : DEFAULT_COLLECTION_TYPE;
}

function normalizeDispatchToken(value, fallback) {
  const text = String(value ?? '').trim();
  return DISPATCH_TOKEN.test(text) ? text.toUpperCase() : fallback;
}

function normalizeCourierCode(value) {
  return normalizeDispatchToken(value, DEFAULT_COURIER);
}

function normalizeServiceType(value) {
  return normalizeDispatchToken(value, DEFAULT_SERVICE_TYPE);
}

function dispatchFrom(row) {
  return {
    collectionType: normalizeCollectionType(row?.collectionType),
    courierCode: normalizeCourierCode(row?.courierCode),
    serviceType: normalizeServiceType(row?.serviceType),
  };
}

async function readCollectionType(strapi) {
  const row = await strapi.db.query(UID).findOne({});
  return normalizeCollectionType(row?.collectionType);
}

async function readDispatch(strapi) {
  const row = await strapi.db.query(UID).findOne({});
  return dispatchFrom(row);
}

async function ensureCollectionType(strapi) {
  const row = await strapi.db.query(UID).findOne({});
  if (!row) {
    return;
  }
  const normalized = dispatchFrom(row);
  if (
    row.collectionType === normalized.collectionType
    && row.courierCode === normalized.courierCode
    && row.serviceType === normalized.serviceType
  ) {
    return;
  }
  await strapi.db.query(UID).update({
    where: { id: row.id },
    data: normalized,
  });
}

module.exports = {
  UID,
  PICK_UP,
  COURIER_DROP_OFF,
  POSTEX_DROP_OFF,
  DEFAULT_COLLECTION_TYPE,
  DEFAULT_COURIER,
  DEFAULT_SERVICE_TYPE,
  normalizeCollectionType,
  normalizeCourierCode,
  normalizeServiceType,
  readCollectionType,
  readDispatch,
  ensureCollectionType,
};

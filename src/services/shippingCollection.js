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

function normalizeCollectionType(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return ALLOWED.has(text) ? text : DEFAULT_COLLECTION_TYPE;
}

async function readCollectionType(strapi) {
  const row = await strapi.db.query(UID).findOne({});
  return normalizeCollectionType(row?.collectionType);
}

async function ensureCollectionType(strapi) {
  const row = await strapi.db.query(UID).findOne({});
  if (!row) {
    return;
  }
  const normalized = normalizeCollectionType(row.collectionType);
  if (row.collectionType === normalized) {
    return;
  }
  await strapi.db.query(UID).update({
    where: { id: row.id },
    data: { collectionType: normalized },
  });
}

module.exports = {
  UID,
  PICK_UP,
  COURIER_DROP_OFF,
  POSTEX_DROP_OFF,
  DEFAULT_COLLECTION_TYPE,
  normalizeCollectionType,
  readCollectionType,
  ensureCollectionType,
};

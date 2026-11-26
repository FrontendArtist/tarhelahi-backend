'use strict';

/**
 * روش جمع‌آوری سراسری (S1-01). استعلام هزینه و ساخت مرسوله هر دو همین مقدار را می‌خوانند.
 * پیش‌فرض مصوب تحویل توسط خودمان است. مقدار تهی یا خارج از فهرست همان پیش‌فرض است.
 */

const UID = 'api::shipping-setting.shipping-setting';

const COST_MODE_FIXED = 'fixed';
const COST_MODE_POSTEX = 'postex';
const DEFAULT_COST_MODE = COST_MODE_POSTEX;
const DEFAULT_FIXED_AMOUNT_IN_NOOR = '170000';
const DEFAULT_RIAL_PER_NOOR_FOR_SHIPPING = '10';

const PICK_UP = 'pick_up';
const COURIER_DROP_OFF = 'courier_drop_off';
const POSTEX_DROP_OFF = 'postex_drop_off';
const ALLOWED = new Set([PICK_UP, COURIER_DROP_OFF, POSTEX_DROP_OFF]);
const DEFAULT_COLLECTION_TYPE = COURIER_DROP_OFF;
const DEFAULT_COURIER = 'IR_POST';
const DEFAULT_SERVICE_TYPE = 'EXPRESS';
const DISPATCH_TOKEN = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

const COST_MODE_LABELS = Object.freeze({
  [COST_MODE_FIXED]: 'نرخ ثابت',
  [COST_MODE_POSTEX]: 'پستکس (استعلام آنلاین)',
});

const COLLECTION_TYPE_LABELS = Object.freeze({
  [PICK_UP]: 'جمع‌آوری توسط پیک',
  [COURIER_DROP_OFF]: 'تحویل توسط خودمان',
  [POSTEX_DROP_OFF]: 'تحویل در دفتر پستی',
});

const COURIER_LABELS = Object.freeze({
  IR_POST: 'شرکت ملی پست',
  CHAPAR: 'چاپار',
  DEKAPOST: 'دکاپست',
  POSTBAR: 'پست بار',
  POSTEX_EXPRESS: 'پستکس وان (بین‌شهری)',
  COREPOSTING: 'پستکس وان (درون‌شهری و عادی)',
  BAREXPRESS: 'باراکسپرس',
});

const SERVICE_LABELS = Object.freeze({
  EXPRESS: 'پست پیشتاز',
  PRIORITY: 'پست ویژه',
  POSTEXPRESS: 'پست اکسپرس',
  CHAPAR: 'چاپار',
  POSTBAR_EXPRESS: 'پست بار اکسپرس',
  DGX_GOLD: 'پستکس وان - ویژه - بین شهری',
  DGX_STANDARD: 'پستکس وان - اکسپرس',
  DGX_BUSINESS: 'پستکس وان - سازمانی',
  COREPOSTING_GOLD: 'پستکس وان - ویژه - درون شهری',
  COREPOSTING_CARD: 'پستکس وان - عادی',
  DEKBETCITY: 'دکاپیشرو بین شهری',
  DEKINCITY: 'دکاپیشرو درون شهری',
  DEKBARBETCITY: 'دکابار بین شهری',
  DEKBARINCITY: 'دکابار شهری',
  DEKBACHBETCITY: 'پست بار کیسه‌ای - دکابار (بین شهری)',
  DEKBACHINCITY: 'پست بار کیسه‌ای - دکابار (درون شهری)',
  T2D: 'باراکسپرس (ترمینال به درب)',
  T2T: 'باراکسپرس (ترمینال به ترمینال)',
});

function invertMap(record) {
  return new Map(Object.entries(record).map(([code, label]) => [label, code]));
}

const COST_MODE_FROM_LABEL = invertMap(COST_MODE_LABELS);
const COLLECTION_TYPE_FROM_LABEL = invertMap(COLLECTION_TYPE_LABELS);
const COURIER_FROM_LABEL = invertMap(COURIER_LABELS);
const SERVICE_FROM_LABEL = invertMap(SERVICE_LABELS);

function normalizeCostMode(value) {
  const text = String(value ?? '').trim();
  if (COST_MODE_FROM_LABEL.has(text)) {
    return COST_MODE_FROM_LABEL.get(text);
  }
  const lower = text.toLowerCase();
  if (lower === COST_MODE_FIXED) {
    return COST_MODE_FIXED;
  }
  if (lower === COST_MODE_POSTEX) {
    return COST_MODE_POSTEX;
  }
  return DEFAULT_COST_MODE;
}

function normalizeCollectionType(value) {
  const text = String(value ?? '').trim();
  if (COLLECTION_TYPE_FROM_LABEL.has(text)) {
    return COLLECTION_TYPE_FROM_LABEL.get(text);
  }
  const lower = text.toLowerCase();
  return ALLOWED.has(lower) ? lower : DEFAULT_COLLECTION_TYPE;
}

function normalizeDispatchToken(value, fallback, labelToCode) {
  const text = String(value ?? '').trim();
  if (labelToCode && labelToCode.has(text)) {
    return labelToCode.get(text);
  }
  return DISPATCH_TOKEN.test(text) ? text.toUpperCase() : fallback;
}

function normalizeCourierCode(value) {
  return normalizeDispatchToken(value, DEFAULT_COURIER, COURIER_FROM_LABEL);
}

function normalizeServiceType(value) {
  return normalizeDispatchToken(value, DEFAULT_SERVICE_TYPE, SERVICE_FROM_LABEL);
}

function adminValuesFrom(row) {
  const costMode = COST_MODE_LABELS[normalizeCostMode(row?.costMode)];
  const collectionType = COLLECTION_TYPE_LABELS[normalizeCollectionType(row?.collectionType)];
  const courierCode = COURIER_LABELS[normalizeCourierCode(row?.courierCode)] || COURIER_LABELS[DEFAULT_COURIER];
  const serviceType = SERVICE_LABELS[normalizeServiceType(row?.serviceType)] || SERVICE_LABELS[DEFAULT_SERVICE_TYPE];
  return { costMode, collectionType, courierCode, serviceType };
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
    await strapi.db.query(UID).create({
      data: {
        ...adminValuesFrom({}),
        fixedAmountInNoor: DEFAULT_FIXED_AMOUNT_IN_NOOR,
        rialPerNoorForShipping: DEFAULT_RIAL_PER_NOOR_FOR_SHIPPING,
      },
    });
    return;
  }
  const target = adminValuesFrom(row);
  if (
    row.costMode === target.costMode
    && row.collectionType === target.collectionType
    && row.courierCode === target.courierCode
    && row.serviceType === target.serviceType
  ) {
    return;
  }
  await strapi.db.query(UID).update({
    where: { id: row.id },
    data: target,
  });
}

module.exports = {
  UID,
  COST_MODE_FIXED,
  COST_MODE_POSTEX,
  DEFAULT_COST_MODE,
  DEFAULT_FIXED_AMOUNT_IN_NOOR,
  DEFAULT_RIAL_PER_NOOR_FOR_SHIPPING,
  PICK_UP,
  COURIER_DROP_OFF,
  POSTEX_DROP_OFF,
  DEFAULT_COLLECTION_TYPE,
  DEFAULT_COURIER,
  DEFAULT_SERVICE_TYPE,
  COST_MODE_LABELS,
  COLLECTION_TYPE_LABELS,
  COURIER_LABELS,
  SERVICE_LABELS,
  normalizeCostMode,
  normalizeCollectionType,
  normalizeCourierCode,
  normalizeServiceType,
  adminValuesFrom,
  readCollectionType,
  readDispatch,
  ensureCollectionType,
};

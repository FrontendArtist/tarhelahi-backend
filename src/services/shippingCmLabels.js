'use strict';

/**
 * برچسب فارسی فیلدهای ارسال و محل در Content-Manager (فاز اول).
 * بدون نام حامل در برچسب‌ها.
 */

const LABEL_PATCHES = {
  'api::shipping-setting.shipping-setting': {
    costMode: 'حالت هزینه ارسال',
    fixedAmountInNoor: 'مبلغ ثابت ارسال (نور)',
    freeShippingThresholdInNoor: 'آستانهٔ ارسال رایگان (نور)',
    rialPerNoorForShipping: 'نرخ ریال به نور برای ارسال',
  },
  'api::shipping-origin.shipping-origin': {
    originId: 'شناسه مبدأ',
    displayName: 'نام نمایشی انبار',
    city: 'شهر مبدأ',
  },
  'api::product.product': {
    shippingOrigin: 'مبدأ ارسال',
  },
  'api::address.address': {
    cityLink: 'شهر',
  },
  'api::province.province': {
    externalId: 'شناسه محل',
    name: 'نام استان',
    cities: 'شهرها',
  },
  'api::city.city': {
    externalId: 'شناسه محل',
    name: 'نام شهر',
    province: 'استان',
  },
};

/** شناسهٔ محل پس از همگام‌سازی در پنل فقط خواندنی. */
const READONLY_FIELDS = {
  'api::province.province': ['externalId'],
  'api::city.city': ['externalId'],
};

function applyLabels(metadatas, labels, readonlyFields = []) {
  if (!metadatas || typeof metadatas !== 'object') {
    return { changed: false, metadatas };
  }
  let changed = false;
  const next = { ...metadatas };
  for (const [field, label] of Object.entries(labels)) {
    const current = next[field] || {};
    const edit = {
      ...(current.edit || {}),
      label,
      ...(readonlyFields.includes(field) ? { editable: false } : {}),
    };
    const list = { ...(current.list || {}), label };
    if (
      current.edit?.label !== label
      || current.list?.label !== label
      || (readonlyFields.includes(field) && current.edit?.editable !== false)
    ) {
      changed = true;
    }
    next[field] = { ...current, edit, list };
  }
  return { changed, metadatas: next };
}

async function ensureShippingCmLabels(strapi) {
  for (const [uid, labels] of Object.entries(LABEL_PATCHES)) {
    const key = `configuration_content_types::${uid}`;
    const store = strapi.store({ type: 'plugin', name: 'content_manager', key });
    const conf = await store.get();
    if (!conf || typeof conf !== 'object') {
      continue;
    }
    const { changed, metadatas } = applyLabels(
      conf.metadatas,
      labels,
      READONLY_FIELDS[uid] || [],
    );
    if (!changed) {
      continue;
    }
    await store.set({ value: { ...conf, metadatas } });
  }
}

module.exports = {
  LABEL_PATCHES,
  applyLabels,
  ensureShippingCmLabels,
};

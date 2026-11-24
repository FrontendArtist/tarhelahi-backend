'use strict';

/**
 * برچسب فارسی فیلدهای ارسال و محل در Content-Manager (فاز اول).
 * بدون نام حامل در برچسب‌ها.
 */

const LABEL_PATCHES = {
  'api::shipping-setting.shipping-setting': {
    costMode: 'حالت هزینه ارسال',
    collectionType: 'روش جمع‌آوری',
    courierCode: 'کوریر پیش‌فرض',
    serviceType: 'سرویس پیش‌فرض',
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

/** فیلدهای فقط خواندنی در پنل ادمین (شناسه‌های محل و نرخ ارسال بای‌مانی). */
const READONLY_FIELDS = {
  'api::shipping-setting.shipping-setting': ['rialPerNoorForShipping'],
  'api::province.province': ['externalId'],
  'api::city.city': ['externalId'],
};

const FIELD_DESCRIPTIONS = {
  'api::shipping-setting.shipping-setting': {
    rialPerNoorForShipping: 'تنها به صورت نمایشی از دیتابیس بای‌مانی خوانده می‌شود.',
    collectionType: 'پیک (pick_up)، تحویل توسط خودمان (courier_drop_off، پیش‌فرض)، تحویل در دفتر پست (postex_drop_off). استعلام و ساخت مرسوله همین مقدار را می‌خوانند. تحویل در دفتر تا ثبت شناسهٔ دفتر در فاز بعد قابل استفاده نیست و ساخت مرسوله را رد می‌کند.',
    courierCode: 'پیش‌فرض IR_POST. استعلام و ساخت مرسوله همین مقدار را می‌خوانند. تهی یا نامعتبر به پیش‌فرض برمی‌گردد.',
    serviceType: 'پیش‌فرض EXPRESS. استعلام و ساخت مرسوله همین مقدار را می‌خوانند. تهی یا نامعتبر به پیش‌فرض برمی‌گردد.',
  },
};

function applyLabels(metadatas, labels, readonlyFields = [], descriptions = {}) {
  if (!metadatas || typeof metadatas !== 'object') {
    return { changed: false, metadatas };
  }
  let changed = false;
  const next = { ...metadatas };
  for (const [field, label] of Object.entries(labels)) {
    const current = next[field] || {};
    const descPatch = descriptions[field] !== undefined ? { description: descriptions[field] } : {};
    const edit = {
      ...(current.edit || {}),
      label,
      ...descPatch,
      ...(readonlyFields.includes(field) ? { editable: false } : {}),
    };
    const list = { ...(current.list || {}), label };
    if (
      current.edit?.label !== label
      || current.list?.label !== label
      || (descriptions[field] !== undefined && current.edit?.description !== descriptions[field])
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
      FIELD_DESCRIPTIONS[uid] || {},
    );
    if (!changed) {
      continue;
    }
    await store.set({ value: { ...conf, metadatas } });
  }
}

module.exports = {
  LABEL_PATCHES,
  READONLY_FIELDS,
  FIELD_DESCRIPTIONS,
  applyLabels,
  ensureShippingCmLabels,
};

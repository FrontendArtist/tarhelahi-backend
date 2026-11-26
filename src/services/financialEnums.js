'use strict';

const { asyncLocalStorage } = require('../utils/uploadPath');

/**
 * نگاشت دوزبانه (کد انگلیسی <-> برچسب فارسی) برای تمام فیلدهای Enumeration بخش‌های مالی.
 * در دیتابیس و اسکیماهای Strapi مقادیر فارسی ذخیره می‌شوند تا در Content Manager فارسی نمایش داده شوند،
 * و لایه‌های میان‌افزار و lifecycle به‌صورت خودکار با کدهای انگلیسی API/بای‌مانی/درگاه همگام‌سازی می‌کنند.
 */
const FINANCIAL_ENUMS = Object.freeze({
  'api::order.order': Object.freeze({
    orderStatus: Object.freeze({
      shipped: 'ارسال شده',
      paid: 'پرداخت شده',
      pending: 'در انتظار',
      canceled: 'لغو شده',
      delivered: 'تحویل داده شده',
    }),
    paymentMethod: Object.freeze({
      online: 'آنلاین',
      card_to_card: 'کارت به کارت',
      free: 'رایگان',
    }),
    paymentStatus: Object.freeze({
      pending_payment: 'در انتظار پرداخت',
      pending_verification: 'در انتظار تأیید',
      paid: 'پرداخت شده',
      failed: 'ناموفق',
    }),
    currency: Object.freeze({
      toman: 'تومان',
      noor: 'نور',
    }),
  }),
  'api::coupon.coupon': Object.freeze({
    discountType: Object.freeze({
      percentage: 'درصدی',
      fixed: 'مبلغ ثابت',
    }),
  }),
  'api::gateway-payment-attempt.gateway-payment-attempt': Object.freeze({
    status: Object.freeze({
      created: 'ایجاد شده',
      token_issued: 'توکن صادر شده',
      verifying: 'در حال استعلام',
      verified: 'تأیید شده توسط بانک',
      confirmed: 'تأیید نهایی شده',
      review: 'نیازمند بررسی',
      financial_review: 'نیازمند بررسی مالی',
      reverse_required: 'نیازمند بازگشت وجه',
      reversed: 'وجه بازگشت داده شده',
      failed: 'ناموفق',
      cancelled: 'لغو شده',
      pending_sync: 'در انتظار همگام‌سازی',
    }),
  }),
  'api::gateway-payment-event.gateway-payment-event': Object.freeze({
    stage: Object.freeze({
      callback: 'بازگشت از درگاه',
      verify: 'تأیید تراکنش',
      reverse: 'بازگشت وجه',
      reverse_intent: 'درخواست بازگشت وجه',
    }),
    kind: Object.freeze({
      Unpaid: 'پرداخت نشده',
      Verified: 'تأیید شده',
      ReverseSucceeded: 'بازگشت وجه موفق',
      ReverseFailed: 'بازگشت وجه ناموفق',
      Unknown: 'نامشخص',
    }),
    deliveryStatus: Object.freeze({
      pending: 'در انتظار ارسال',
      delivered: 'تحویل شده',
      review: 'نیازمند بررسی',
    }),
  }),
  'api::gateway-review-case.gateway-review-case': Object.freeze({
    reasonCode: Object.freeze({
      NO_CALLBACK: 'بدون بازگشت از درگاه',
      VERIFY_UNKNOWN: 'نتیجه نامشخص استعلام',
      REVERSE_UNKNOWN: 'نتیجه نامشخص بازگشت وجه',
      DELIVERY_UNKNOWN: 'نتیجه نامشخص ارسال به بای‌مانی',
      BANK_CONFLICT: 'تعارض اطلاعات بانکی',
    }),
    status: Object.freeze({
      open: 'باز',
      resolved: 'حل‌شده',
    }),
    notificationStatus: Object.freeze({
      pending: 'در انتظار ارسال',
      delivered: 'تحویل شده',
      conflict: 'دارای تعارض',
    }),
  }),
  'api::gateway-review-case-history.gateway-review-case-history': Object.freeze({
    syncStatus: Object.freeze({
      pending: 'در انتظار همگام‌سازی',
      delivered: 'تحویل شده',
    }),
  }),
  'api::gateway-review-operation.gateway-review-operation': Object.freeze({
    status: Object.freeze({
      pending: 'در انتظار',
      applied: 'اعمال شده',
      rejected: 'رد شده',
    }),
  }),
  'api::byemoney-cart.byemoney-cart': Object.freeze({
    state: Object.freeze({
      reserved: 'رزرو شده',
      committed: 'نهایی شده',
      released: 'آزاد شده',
    }),
  }),
  'api::byemoney-purchase-log.byemoney-purchase-log': Object.freeze({
    itemType: Object.freeze({
      course: 'دوره',
      course_chapter: 'فصل دوره',
    }),
    status: Object.freeze({
      processed: 'پردازش شده',
    }),
  }),
});

const RELATED_ORDER_UIDS = Object.freeze([
  'api::settlement.settlement',
  'plugin::users-permissions.user',
]);

const ALL_WATCHED_UIDS = Object.freeze([
  ...Object.keys(FINANCIAL_ENUMS),
  ...RELATED_ORDER_UIDS,
]);

// ساخت ایندکس سریع برای تبدیل دوطرفه (حساس و غیرحساس به حروف بزرگ/کوچک)
const FIELD_INDEX = new Map();
for (const [uid, fields] of Object.entries(FINANCIAL_ENUMS)) {
  const fieldMap = new Map();
  for (const [field, codeToLabel] of Object.entries(fields)) {
    const labelToCode = new Map();
    const lowerCodeToLabel = new Map();
    const lowerCodeToCanonical = new Map();
    for (const [code, label] of Object.entries(codeToLabel)) {
      labelToCode.set(label, code);
      lowerCodeToLabel.set(code.toLowerCase(), label);
      lowerCodeToCanonical.set(code.toLowerCase(), code);
    }
    fieldMap.set(field, {
      codeToLabel,
      labelToCode,
      lowerCodeToLabel,
      lowerCodeToCanonical,
    });
  }
  FIELD_INDEX.set(uid, fieldMap);
}

function getFieldIndex(uid, field) {
  return FIELD_INDEX.get(uid)?.get(field) || null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * تبدیل مقدار انگلیسی (یا فارسی) به برچسب فارسی متناظر در اسکیما.
 */
function toLabel(uid, field, value) {
  if (value == null || typeof value !== 'string') {
    return value;
  }
  const idx = getFieldIndex(uid, field);
  if (!idx) {
    return value;
  }
  const trimmed = value.trim();
  if (Object.prototype.hasOwnProperty.call(idx.codeToLabel, trimmed)) {
    return idx.codeToLabel[trimmed];
  }
  if (idx.labelToCode.has(trimmed)) {
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  if (idx.lowerCodeToLabel.has(lower)) {
    return idx.lowerCodeToLabel.get(lower);
  }
  return value;
}

/**
 * تبدیل برچسب فارسی (یا کد انگلیسی) به کد استاندارد انگلیسی.
 */
function toCode(uid, field, value) {
  if (value == null || typeof value !== 'string') {
    return value;
  }
  const idx = getFieldIndex(uid, field);
  if (!idx) {
    return value;
  }
  const trimmed = value.trim();
  if (idx.labelToCode.has(trimmed)) {
    return idx.labelToCode.get(trimmed);
  }
  if (Object.prototype.hasOwnProperty.call(idx.codeToLabel, trimmed)) {
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  if (idx.lowerCodeToCanonical.has(lower)) {
    return idx.lowerCodeToCanonical.get(lower);
  }
  return value;
}

/**
 * تبدیل فیلدهای Enumeration در آبجکت data به مقادیر فارسی (بدون تغییر آبجکت ورودی).
 */
function translateDataToLabels(uid, data) {
  if (!isPlainObject(data) || !FINANCIAL_ENUMS[uid]) {
    return data;
  }
  const fields = FINANCIAL_ENUMS[uid];
  let next = null;
  for (const field of Object.keys(fields)) {
    if (Object.prototype.hasOwnProperty.call(data, field) && typeof data[field] === 'string') {
      const translated = toLabel(uid, field, data[field]);
      if (translated !== data[field]) {
        if (!next) next = { ...data };
        next[field] = translated;
      }
    }
  }
  return next || data;
}

const SCALAR_OPS = new Set(['$eq', '$ne', '$eqi', '$nei']);
const ARRAY_OPS = new Set(['$in', '$notIn']);

function translateFieldFilterValue(uid, field, val) {
  if (typeof val === 'string') {
    return toLabel(uid, field, val);
  }
  if (Array.isArray(val)) {
    return val.map((item) => (typeof item === 'string' ? toLabel(uid, field, item) : item));
  }
  if (isPlainObject(val)) {
    const cloned = { ...val };
    for (const [op, opVal] of Object.entries(val)) {
      if (SCALAR_OPS.has(op) && typeof opVal === 'string') {
        cloned[op] = toLabel(uid, field, opVal);
      } else if (ARRAY_OPS.has(op) && Array.isArray(opVal)) {
        cloned[op] = opVal.map((item) => (typeof item === 'string' ? toLabel(uid, field, item) : item));
      }
    }
    return cloned;
  }
  return val;
}

/**
 * تبدیل بازگشتی شرط‌های where/filters به مقادیر فارسی (بدون تغییر آبجکت ورودی).
 */
function translateWhereToLabels(uid, where) {
  if (Array.isArray(where)) {
    return where.map((item) => translateWhereToLabels(uid, item));
  }
  if (!isPlainObject(where)) {
    return where;
  }
  const fields = FINANCIAL_ENUMS[uid] || null;
  const isRelatedOrderUid = RELATED_ORDER_UIDS.includes(uid);
  if (!fields && !isRelatedOrderUid) {
    return where;
  }

  const next = {};
  for (const [key, val] of Object.entries(where)) {
    if (key === '$and' || key === '$or') {
      next[key] = Array.isArray(val)
        ? val.map((item) => translateWhereToLabels(uid, item))
        : translateWhereToLabels(uid, val);
    } else if (key === '$not') {
      next[key] = translateWhereToLabels(uid, val);
    } else if (fields && Object.prototype.hasOwnProperty.call(fields, key)) {
      next[key] = translateFieldFilterValue(uid, key, val);
    } else if (isRelatedOrderUid && key === 'orders' && isPlainObject(val)) {
      next[key] = translateWhereToLabels('api::order.order', val);
    } else {
      next[key] = val;
    }
  }
  return next;
}

/**
 * تبدیل مقادیر فارسی رکورد به کدهای انگلیسی به‌صورت درجا (in-place).
 * @strapi/database نتیجهٔ اصلی را پس از afterFindOne/afterFindMany برمی‌گرداند، بنابراین تغییر درجا ضروری است.
 */
function mutateRecordToCodes(uid, record) {
  if (!record || typeof record !== 'object') {
    return record;
  }
  const fields = FINANCIAL_ENUMS[uid];
  if (fields) {
    for (const field of Object.keys(fields)) {
      if (typeof record[field] === 'string') {
        record[field] = toCode(uid, field, record[field]);
      }
    }
  }
  if (RELATED_ORDER_UIDS.includes(uid) && Array.isArray(record.orders)) {
    for (const order of record.orders) {
      mutateRecordToCodes('api::order.order', order);
    }
  }
  return record;
}

function isAdminUiRequest() {
  const ctx = asyncLocalStorage.getStore();
  if (!ctx || typeof ctx.path !== 'string') {
    return false;
  }
  return (
    ctx.path.startsWith('/content-manager') ||
    ctx.path.startsWith('/admin') ||
    ctx.path.startsWith('/content-releases')
  );
}

const WRITE_ACTIONS = new Set(['create', 'update', 'clone', 'publish']);

/**
 * میان‌افزار Document Service برای ترجمه خودکار ورودی/فیلتر به فارسی و خروجی غیر از پنل ادمین به انگلیسی.
 */
function documentMiddleware() {
  return async (context, next) => {
    const { uid, action, params } = context;
    if (!FINANCIAL_ENUMS[uid] && !RELATED_ORDER_UIDS.includes(uid)) {
      return next();
    }
    if (params && params.filters) {
      params.filters = translateWhereToLabels(uid, params.filters);
    }
    if (FINANCIAL_ENUMS[uid] && WRITE_ACTIONS.has(action) && params && params.data) {
      params.data = translateDataToLabels(uid, params.data);
    }
    const result = await next();
    if (!isAdminUiRequest()) {
      if (Array.isArray(result)) {
        for (const item of result) {
          mutateRecordToCodes(uid, item);
        }
      } else if (result && typeof result === 'object') {
        mutateRecordToCodes(uid, result);
      }
    }
    return result;
  };
}

/**
 * ثبت lifecycleهای سطح دیتابیس (strapi.db.lifecycles) برای پوشش کامل db.query.
 */
function registerDbLifecycles(strapi) {
  if (!strapi?.db?.lifecycles?.subscribe) {
    return () => {};
  }
  return strapi.db.lifecycles.subscribe({
    models: ALL_WATCHED_UIDS,
    beforeCreate(event) {
      const uid = event.model?.uid;
      if (uid && FINANCIAL_ENUMS[uid] && event.params?.data) {
        event.params.data = translateDataToLabels(uid, event.params.data);
      }
    },
    beforeCreateMany(event) {
      const uid = event.model?.uid;
      if (uid && FINANCIAL_ENUMS[uid] && Array.isArray(event.params?.data)) {
        event.params.data = event.params.data.map((d) => translateDataToLabels(uid, d));
      }
    },
    beforeUpdate(event) {
      const uid = event.model?.uid;
      if (!uid || !event.params) return;
      if (event.params.where) {
        event.params.where = translateWhereToLabels(uid, event.params.where);
      }
      if (event.params.filters) {
        event.params.filters = translateWhereToLabels(uid, event.params.filters);
      }
      if (FINANCIAL_ENUMS[uid] && event.params.data) {
        event.params.data = translateDataToLabels(uid, event.params.data);
      }
    },
    beforeUpdateMany(event) {
      const uid = event.model?.uid;
      if (!uid || !event.params) return;
      if (event.params.where) {
        event.params.where = translateWhereToLabels(uid, event.params.where);
      }
      if (event.params.filters) {
        event.params.filters = translateWhereToLabels(uid, event.params.filters);
      }
      if (FINANCIAL_ENUMS[uid] && event.params.data) {
        event.params.data = translateDataToLabels(uid, event.params.data);
      }
    },
    beforeFindOne(event) {
      const uid = event.model?.uid;
      if (!uid || !event.params) return;
      if (event.params.where) {
        event.params.where = translateWhereToLabels(uid, event.params.where);
      }
      if (event.params.filters) {
        event.params.filters = translateWhereToLabels(uid, event.params.filters);
      }
    },
    beforeFindMany(event) {
      const uid = event.model?.uid;
      if (!uid || !event.params) return;
      if (event.params.where) {
        event.params.where = translateWhereToLabels(uid, event.params.where);
      }
      if (event.params.filters) {
        event.params.filters = translateWhereToLabels(uid, event.params.filters);
      }
    },
    beforeCount(event) {
      const uid = event.model?.uid;
      if (!uid || !event.params) return;
      if (event.params.where) {
        event.params.where = translateWhereToLabels(uid, event.params.where);
      }
      if (event.params.filters) {
        event.params.filters = translateWhereToLabels(uid, event.params.filters);
      }
    },
    beforeDelete(event) {
      const uid = event.model?.uid;
      if (!uid || !event.params) return;
      if (event.params.where) {
        event.params.where = translateWhereToLabels(uid, event.params.where);
      }
      if (event.params.filters) {
        event.params.filters = translateWhereToLabels(uid, event.params.filters);
      }
    },
    beforeDeleteMany(event) {
      const uid = event.model?.uid;
      if (!uid || !event.params) return;
      if (event.params.where) {
        event.params.where = translateWhereToLabels(uid, event.params.where);
      }
      if (event.params.filters) {
        event.params.filters = translateWhereToLabels(uid, event.params.filters);
      }
    },
    afterFindOne(event) {
      const uid = event.model?.uid;
      if (!uid || !event.result || isAdminUiRequest()) return;
      mutateRecordToCodes(uid, event.result);
    },
    afterFindMany(event) {
      const uid = event.model?.uid;
      if (!uid || !Array.isArray(event.result) || isAdminUiRequest()) return;
      for (const row of event.result) {
        mutateRecordToCodes(uid, row);
      }
    },
  });
}

/**
 * مهاجرت ایمن و idempotent مقادیر قدیمی انگلیسی در دیتابیس به برچسب‌های فارسی.
 */
async function migrateFinancialEnums(strapi) {
  const knex = strapi?.db?.connection;
  if (!knex?.schema?.hasTable) {
    return { migrated: 0 };
  }
  let migrated = 0;
  for (const [uid, fields] of Object.entries(FINANCIAL_ENUMS)) {
    const meta = strapi.db?.metadata?.get?.(uid);
    if (!meta?.tableName) continue;
    if (!(await knex.schema.hasTable(meta.tableName))) continue;

    for (const [field, codeToLabel] of Object.entries(fields)) {
      const columnName = meta.attributes?.[field]?.columnName || field;
      if (!(await knex.schema.hasColumn(meta.tableName, columnName))) continue;

      for (const [code, label] of Object.entries(codeToLabel)) {
        if (code === label) continue;
        const count = await knex(meta.tableName)
          .where(columnName, code)
          .update({ [columnName]: label });
        migrated += Number(count) || 0;
      }
    }
  }
  if (migrated > 0) {
    strapi.log?.info?.(`[FinancialEnums] Migrated ${migrated} legacy enum values to Persian.`);
  }
  return { migrated };
}

module.exports = {
  FINANCIAL_ENUMS,
  RELATED_ORDER_UIDS,
  ALL_WATCHED_UIDS,
  toLabel,
  toCode,
  translateDataToLabels,
  translateWhereToLabels,
  mutateRecordToCodes,
  isAdminUiRequest,
  documentMiddleware,
  registerDbLifecycles,
  migrateFinancialEnums,
};

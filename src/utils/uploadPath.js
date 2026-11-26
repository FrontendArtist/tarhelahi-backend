// path: backend/src/utils/uploadPath.js
'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const asyncLocalStorage = new AsyncLocalStorage();

/**
 * نگاشت content-type به مسیر پوشه در Object Storage
 */
const CONTENT_TYPE_FOLDER_MAP = {
  'api::product.product': 'media/products',
  'api::article.article': 'media/articles',
  'api::course.course': 'media/courses',
  'api::category.category': 'media/categories',
  'api::articles-category.articles-category': 'media/categories',
  'api::service.service': 'media/services',
  'api::popup-message.popup-message': 'media/popups',
  'api::social.social': 'media/social',
  'api::testimontial.testimontial': 'media/testimonials',
  'api::message.message': 'media/voices',
  'api::order.order': 'receipts',
};

const ALLOWED_UPLOAD_PATHS = new Set([
  'media',
  ...Object.values(CONTENT_TYPE_FOLDER_MAP),
]);

/**
 * اعتبارسنجی و محدودسازی مسیر ذخیره در Object Storage به فهرست ثابت مجاز (M14)
 */
function sanitizeUploadPath(rawPath) {
  if (typeof rawPath !== 'string') return null;
  const cleaned = rawPath.trim().replace(/^\/+|\/+$/g, '');
  if (!cleaned || cleaned.includes('..') || cleaned.includes('\\') || cleaned.includes('\0')) {
    return null;
  }
  return ALLOWED_UPLOAD_PATHS.has(cleaned) ? cleaned : null;
}

/**
 * بررسی اینکه آیا فایل صوتی / وویس مربوط به صفحه mentor یا چت است
 */
function isVoiceFile(file) {
  const mime = file.mime || file.type || '';
  const name = (file.name || file.filename || '').toLowerCase();
  return (
    mime.startsWith('audio/') ||
    name.startsWith('voice_') ||
    name.includes('mentor') ||
    name.endsWith('.ogg') ||
    name.endsWith('.mp3') ||
    name.endsWith('.wav') ||
    name.endsWith('.m4a') ||
    (name.endsWith('.webm') && name.includes('voice'))
  );
}

/**
 * تشخیص نوع محتوا از روی آدرس صفحه فرستنده در ادمین استراپی (Referer Header)
 */
function getPathFromReferer(referer) {
  if (!referer) return null;

  // استخراج Content Type از روی URL ادمین استراپی
  // e.g. /content-manager/collection-types/api::product.product/create
  const apiMatch = referer.match(/api::([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)/);
  if (apiMatch) {
    const fullUid = `api::${apiMatch[1]}.${apiMatch[2]}`;
    if (CONTENT_TYPE_FOLDER_MAP[fullUid]) {
      return CONTENT_TYPE_FOLDER_MAP[fullUid];
    }
    return `media/${apiMatch[1]}s`;
  }

  // اگر ارسال از صفحه گفتگو یا پنل منتور باشد
  if (referer.includes('/mentor')) {
    return 'media/voices';
  }

  return null;
}

/**
 * دریافت نام پوشه در Media Library استراپی بر اساس ID پوشه
 */
async function getPathFromFolder(folderId, strapi) {
  if (!folderId || !strapi?.db) return null;
  try {
    const folder = await strapi.db.query('plugin::upload.folder').findOne({
      where: { id: folderId },
      select: ['name'],
    });
    if (folder?.name) {
      const cleanName = folder.name.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '-');
      if (cleanName === 'product' || cleanName === 'products') return 'media/products';
      if (cleanName === 'article' || cleanName === 'articles') return 'media/articles';
      if (cleanName === 'course' || cleanName === 'courses') return 'media/courses';
      if (cleanName === 'category' || cleanName === 'categories') return 'media/categories';
      if (cleanName === 'voice' || cleanName === 'voices') return 'media/voices';
      return `media/${cleanName}`;
    }
  } catch {
    // خطا در کوئری نادیده گرفته می‌شود
  }
  return null;
}

/**
 * مسیر نهایی ذخیره فایل در Object Storage را تعیین می‌کند.
 */
async function resolveFilePath(file, strapi) {
  // ۱. اگر فایل از قبل path معتبر از فهرست مجاز دارد، حفظ شود؛ در غیر این صورت نادیده گرفته شود
  if (file.path) {
    const safeFilePath = sanitizeUploadPath(file.path);
    if (safeFilePath) {
      return safeFilePath;
    }
    strapi?.log?.warn?.(`[Storage] Ignored disallowed file.path: "${String(file.path).slice(0, 120)}"`);
  }

  // ۲. اگر فایل صوتی / وویس منتور است
  if (isVoiceFile(file)) {
    return 'media/voices';
  }

  // ۳. بررسی اطلاعات درخواست جاری (Koa ctx)
  const ctx = asyncLocalStorage.getStore();
  if (ctx) {
    // ۳.۱ فیلد مستقیم path در FormData (فقط از فهرست ثابت پیشوندهای مجاز)
    const bodyPath = ctx.request?.body?.path;
    if (typeof bodyPath === 'string' && bodyPath.trim()) {
      const safeBodyPath = sanitizeUploadPath(bodyPath);
      if (safeBodyPath) {
        return safeBodyPath;
      }
      strapi?.log?.warn?.(`[Storage] Ignored disallowed upload path from request: "${bodyPath.trim().slice(0, 120)}"`);
    }

    // ۳.۲ تشخیص از هدر Referer در ادمین پنل استراپی
    const referer = ctx.request?.headers?.referer || ctx.request?.headers?.referrer || '';
    const refererPath = getPathFromReferer(referer);
    if (refererPath) {
      return refererPath;
    }

    // ۳.۳ تشخیص پوشه انتخاب شده در Media Library استراپی
    let folderId = file.folder;
    if (!folderId && ctx.request?.body?.fileInfo) {
      try {
        const parsed = typeof ctx.request.body.fileInfo === 'string'
          ? JSON.parse(ctx.request.body.fileInfo)
          : ctx.request.body.fileInfo;
        folderId = parsed?.folder;
      } catch {
        // نادیده گرفته شود
      }
    }
    if (folderId) {
      const folderPath = await getPathFromFolder(folderId, strapi);
      if (folderPath) {
        return folderPath;
      }
    }
  }

  // ۴. اگر فایل به entity خاصی در Strapi متصل است
  if (Array.isArray(file.related) && file.related.length > 0) {
    for (const rel of file.related) {
      const contentType = rel.__type || rel.kind;
      if (contentType && CONTENT_TYPE_FOLDER_MAP[contentType]) {
        return CONTENT_TYPE_FOLDER_MAP[contentType];
      }
    }
  }

  // ۵. پیش‌فرض فایل‌های متفرقه: مستقیماً درون media ذخیره شوند بدون پوشه اضافی
  return 'media';
}

module.exports = {
  CONTENT_TYPE_FOLDER_MAP,
  ALLOWED_UPLOAD_PATHS,
  sanitizeUploadPath,
  isVoiceFile,
  getPathFromReferer,
  getPathFromFolder,
  resolveFilePath,
  asyncLocalStorage,
};

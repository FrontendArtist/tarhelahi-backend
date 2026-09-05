// path: backend/src/index.js
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
  // ۱. اگر فایل از قبل path مشخص دارد (مثلاً receipt)، دست نزن
  if (file.path) {
    return file.path;
  }

  // ۲. اگر فایل صوتی / وویس منتور است
  if (isVoiceFile(file)) {
    return 'media/voices';
  }

  // ۳. بررسی اطلاعات درخواست جاری (Koa ctx)
  const ctx = asyncLocalStorage.getStore();
  if (ctx) {
    // ۳.۱ فیلد مستقیم path در FormData
    const bodyPath = ctx.request?.body?.path;
    if (typeof bodyPath === 'string' && bodyPath.trim()) {
      return bodyPath.trim();
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
  /**
   * The register hook runs before the application is fully initialized.
   */
  register({ strapi }) {
    strapi.server.app.proxy = true;

    // ثبت middleware سراسری برای نگه‌داری context درخواست به صورت async-safe
    strapi.server.use((ctx, next) => {
      return asyncLocalStorage.run(ctx, next);
    });
  },

  /**
   * Bootstrap: آماده‌سازی upload provider و اعمال مسیر اختصاصی
   */
  bootstrap({ strapi }) {
    const uploadPlugin = strapi.plugin('upload');
    if (!uploadPlugin) return;

    const providerName = strapi.config.get('plugin::upload.provider', '');
    if (providerName !== 'aws-s3') {
      strapi.log.info('[Storage] Local upload provider detected, skipping S3 path middleware.');
      return;
    }

    const provider = uploadPlugin.provider;
    if (!provider) {
      strapi.log.warn('[Storage] Upload provider not initialized yet.');
      return;
    }

    const originalUpload = provider.upload?.bind(provider);
    const originalUploadStream = provider.uploadStream?.bind(provider);

    async function ensureFilePath(file) {
      const resolvedPath = await resolveFilePath(file, strapi);
      if (resolvedPath !== file.path) {
        file.path = resolvedPath;
      }
    }

    if (originalUpload) {
      provider.upload = async (file, customParams = {}) => {
        await ensureFilePath(file);
        return originalUpload(file, customParams);
      };
    }

    if (originalUploadStream) {
      provider.uploadStream = async (file, customParams = {}) => {
        await ensureFilePath(file);
        return originalUploadStream(file, customParams);
      };
    }

    strapi.log.info('[Storage] Enhanced upload path middleware registered with referer & voice detection.');
  },
};
'use strict';

const REVALIDATABLE_UIDS = new Set([
  'api::category.category',
  'api::article.article',
  'api::articles-category.articles-category',
  'api::course.course',
  'api::product.product',
  'api::service.service',
  'api::faq.faq',
  'api::testimontial.testimontial',
  'api::top-banner.top-banner',
  'api::popup-message.popup-message',
  'api::salek-guide.salek-guide',
  'api::surah.surah',
  'api::quran-subject.quran-subject',
  'api::comment.comment',
  'api::social.social',
]);

const MUTATION_ACTIONS = new Set([
  'create',
  'update',
  'delete',
  'publish',
  'unpublish',
  'discardDraft',
]);

const DEFAULT_TIMEOUT_MS = 4000;

function extractModelFromUid(uid) {
  if (typeof uid !== 'string') return '';
  const parts = uid.split('.');
  return parts[parts.length - 1] || '';
}

function getRevalidateConfig(env = process.env) {
  const baseUrl = String(env.NEXT_FRONTEND_URL || '').trim().replace(/\/+$/, '');
  const secret = String(env.REVALIDATE_SECRET || env.STRAPI_WEBHOOK_SECRET || '').trim();
  return { baseUrl, secret };
}

/**
 * ارسال غیرمسدودکننده وب‌هوک بازسازی کش به فرانت‌اند Next.js
 * هرگونه خطای شبکه فقط لاگ می‌شود و ذخیرهٔ محتوا در Strapi را متوقف نمی‌کند.
 */
async function triggerFrontendRevalidate(uid, strapi, env = process.env) {
  const { baseUrl, secret } = getRevalidateConfig(env);
  if (!baseUrl || !secret) return false;

  const model = extractModelFromUid(uid);
  const url = `${baseUrl}/api/revalidate`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-revalidate-secret': secret,
      },
      body: JSON.stringify({ uid, model }),
      signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
        : undefined,
    });

    if (!response.ok) {
      strapi?.log?.warn?.(
        `[FrontendRevalidate] Revalidate webhook for ${uid} returned HTTP ${response.status}`,
      );
      return false;
    }

    return true;
  } catch (error) {
    strapi?.log?.warn?.(
      `[FrontendRevalidate] Revalidate webhook failed for ${uid}: ${error instanceof Error ? error.message : error}`,
    );
    return false;
  }
}

/**
 * Strapi v5 Document Service Middleware:
 * پس از هر ایجاد، ویرایش، انتشار، لغو انتشار یا حذف در محتواهای عمومی،
 * به مسیر POST /api/revalidate در فرانت‌اند اطلاع می‌دهد تا کش همان بخش فوراً تازه شود.
 */
function documentMiddleware(strapi) {
  return async (context, next) => {
    const result = await next();

    if (REVALIDATABLE_UIDS.has(context?.uid) && MUTATION_ACTIONS.has(context?.action)) {
      // Fire-and-forget: پاسخ Strapi معطل شبکهٔ فرانت‌اند نمی‌ماند
      void triggerFrontendRevalidate(context.uid, strapi);
    }

    return result;
  };
}

module.exports = {
  REVALIDATABLE_UIDS,
  MUTATION_ACTIONS,
  extractModelFromUid,
  triggerFrontendRevalidate,
  documentMiddleware,
};

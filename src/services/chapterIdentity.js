'use strict';

const { randomUUID } = require('node:crypto');
const { errors } = require('@strapi/utils');
const COURSE_UID = 'api::course.course';
const CHAPTER_UID = 'course-parts.chapter';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTITY_LOCK = 1869767801;

function invalid(message) {
  throw new errors.ValidationError(message);
}

function normalizeChapters(chapters, existing = [], regenerate = false) {
  const previous = new Map(existing.map((chapter) => [Number(chapter.id), chapter.integrationId]));
  const seen = new Set();
  return chapters.map((chapter) => {
    let integrationId = regenerate ? randomUUID() : chapter.integrationId;
    if (integrationId == null || integrationId === '') {
      integrationId = previous.get(Number(chapter.id)) || randomUUID();
    }
    if (typeof integrationId !== 'string' || !UUID.test(integrationId)) {
      invalid('شناسهٔ اتصال فصل باید UUID معتبر نسخهٔ ۴ باشد.');
    }
    integrationId = integrationId.toLowerCase();
    const previousId = previous.get(Number(chapter.id));
    if (!regenerate && previousId && previousId.toLowerCase() !== integrationId) {
      invalid('شناسهٔ اتصال فصل موجود قابل تغییر نیست.');
    }
    if (seen.has(integrationId)) {
      invalid('شناسهٔ اتصال فصل در یک دوره تکراری است.');
    }
    seen.add(integrationId);
    return { ...chapter, integrationId };
  });
}

function documentMiddleware(strapi) {
  return async (context, next) => {
    const actions = ['create', 'update', 'clone', 'publish', 'discardDraft'];
    if (context.uid !== COURSE_UID || !actions.includes(context.action)) {
      return next();
    }
    return strapi.db.transaction(async ({ trx }) => {
      // دو نسخه UUID مشترک دارند؛ یکتایی میان اسناد با قفل تراکنشی کنترل می‌شود.
      await trx.raw('SELECT pg_advisory_xact_lock(?)', [IDENTITY_LOCK]);
      const params = context.params;
      let existing = [];
      if (params.documentId && ['update', 'clone'].includes(context.action)) {
        const source = await strapi.db.query(COURSE_UID).findOne({
          where: { documentId: params.documentId, publishedAt: null },
          populate: { chapters: { populate: ['lessons'] } },
        });
        existing = source?.chapters || [];
      }
      const data = params.data || {};
      const chapters = data.chapters || (context.action === 'clone' ? existing : null);
      if (Array.isArray(chapters)) {
        params.data = {
          ...data,
          chapters: normalizeChapters(chapters, existing, context.action === 'clone'),
        };
      }
      return next();
    });
  };
}

async function validateCourseEvent(strapi, event) {
  const { data, where } = event.params;
  if (!Array.isArray(data?.chapters)) {
    return;
  }
  const existing = where ? await strapi.db.query(COURSE_UID).findOne({ where }) : null;
  const documentId = data.documentId || existing?.documentId;
  const chapters = [];
  for (const reference of data.chapters) {
    // lifecycle دوره در استرپی ۵ ارجاع کامپوننت از قبل ذخیره‌شده را دریافت می‌کند.
    const chapter = reference.__pivot
      ? await strapi.db.query(CHAPTER_UID).findOne({ where: { id: reference.id } })
      : reference;
    chapters.push(chapter);
  }
  const normalized = normalizeChapters(chapters);
  for (const [index, chapter] of normalized.entries()) {
    const owners = await strapi.db.query(COURSE_UID).findMany({
      where: { chapters: { integrationId: chapter.integrationId } },
    });
    if (owners.some((owner) => owner.documentId !== documentId)) {
      invalid('شناسهٔ اتصال فصل متعلق به دورهٔ دیگری است.');
    }
    const reference = data.chapters[index];
    if (reference?.__pivot) {
      const stored = chapters[index];
      if (stored.integrationId !== chapter.integrationId) {
        await strapi.db.query(CHAPTER_UID).update({
          where: { id: chapter.id },
          data: { integrationId: chapter.integrationId },
        });
      }
    } else if (reference) {
      reference.integrationId = chapter.integrationId;
    }
  }
}

module.exports = { UUID, normalizeChapters, documentMiddleware, validateCourseEvent };

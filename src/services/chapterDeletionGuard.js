'use strict';

const { errors } = require('@strapi/utils');
const COURSE_UID = 'api::course.course';
const LOG_UID = 'api::byemoney-purchase-log.byemoney-purchase-log';

function documentMiddleware(strapi) {
  return async (context, next) => {
    if (context.uid !== COURSE_UID || context.action !== 'update') {
      return next();
    }

    const { params } = context;
    const documentId = params?.documentId;
    const data = params?.data;
    if (!documentId || !data || !Array.isArray(data.chapters)) {
      return next();
    }

    const existing = await strapi.db.query(COURSE_UID).findOne({
      where: { documentId, publishedAt: null },
      populate: { chapters: true },
    });
    const existingChapters = existing?.chapters || [];
    if (existingChapters.length === 0) {
      return next();
    }

    const incomingUuids = new Set(
      data.chapters
        .map((chapter) => (chapter.integrationId ? String(chapter.integrationId).toLowerCase() : null))
        .filter(Boolean),
    );
    const removedChapters = existingChapters.filter(
      (chapter) => chapter.integrationId && !incomingUuids.has(String(chapter.integrationId).toLowerCase()),
    );
    if (removedChapters.length === 0) {
      return next();
    }

    for (const removed of removedChapters) {
      const uuid = String(removed.integrationId).toLowerCase();
      const hasOrder = await strapi.db.connection('components_order_course_order_items')
        .where((builder) => {
          builder.whereRaw('lower(chapter_integration_id) = ?', [uuid]);
          if (removed.id) builder.orWhere('chapter_id', Number(removed.id));
        })
        .first();
      if (hasOrder || await walletOwnsChapter(strapi, uuid, documentId)) {
        throw new errors.ValidationError(
          `فصل «${removed.title || uuid}» قبلاً توسط کاربران خریداری شده است و امکان حذف آن وجود ندارد. در صورت نیاز می‌توانید آن را مخفی یا غیرفعال کنید.`,
        );
      }
    }

    return next();
  };
}

async function walletOwnsChapter(strapi, uuid, documentId) {
  const logs = strapi.db.query(LOG_UID);
  const chapterPurchase = await logs.findOne({
    where: {
      status: 'processed',
      itemType: 'course_chapter',
      chapterExternalId: { $eqi: uuid },
    },
  });
  if (chapterPurchase) return true;
  const coursePurchase = await logs.findOne({
    where: {
      status: 'processed',
      courseId: documentId,
      $or: [{ itemType: 'course' }, { itemType: { $null: true } }],
    },
  });
  return Boolean(coursePurchase);
}

module.exports = { documentMiddleware };

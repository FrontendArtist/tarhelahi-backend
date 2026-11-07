'use strict';

const { errors } = require('@strapi/utils');
const COURSE_UID = 'api::course.course';

function documentMiddleware(strapi) {
  return async (context, next) => {
    // فقط عملیات به‌روزرسانی دوره مد نظر است
    if (context.uid !== COURSE_UID || context.action !== 'update') {
      return next();
    }

    const { params } = context;
    const documentId = params?.documentId;
    const data = params?.data;

    // اگر سرفصل‌ها دستکاری نشده‌اند، نیازی به بررسی حذف نیست
    if (!documentId || !data || !Array.isArray(data.chapters)) {
      return next();
    }

    // واکشی وضعیت فعلی دوره به همراه فصل‌ها
    const existing = await strapi.db.query(COURSE_UID).findOne({
      where: { documentId, publishedAt: null },
      populate: { chapters: true },
    });

    const existingChapters = existing?.chapters || [];
    if (existingChapters.length === 0) {
      return next();
    }

    // استخراج تمام UUIDهای فصل‌های جدید که ارسال شده‌اند
    const incomingUuids = new Set(
      data.chapters
        .map((ch) => (ch.integrationId ? String(ch.integrationId).toLowerCase() : null))
        .filter(Boolean)
    );

    // پیدا کردن فصل‌های قبلی که در لیست جدید نیستند (حذف شده‌اند)
    const removedChapters = existingChapters.filter(
      (oldCh) => oldCh.integrationId && !incomingUuids.has(String(oldCh.integrationId).toLowerCase())
    );

    if (removedChapters.length === 0) {
      return next();
    }

    // بررسی آیا برای این فصل‌های حذف‌شده خریدی در سفارش‌ها ثبت شده است یا خیر
    for (const removed of removedChapters) {
      const uuid = String(removed.integrationId).toLowerCase();

      // ۱. بررسی در جدول اقلام سفارش دوره‌ها بر اساس chapter_integration_id یا chapter_id
      const hasPurchasedItem = await strapi.db.connection('components_order_course_order_items')
        .where((builder) => {
          builder.where('chapter_integration_id', uuid);
          if (removed.id) {
            builder.orWhere('chapter_id', Number(removed.id));
          }
        })
        .first();

      if (hasPurchasedItem) {
        throw new errors.ValidationError(
          `فصل «${removed.title || uuid}» قبلاً توسط کاربران خریداری شده است و امکان حذف آن وجود ندارد. در صورت نیاز می‌توانید آن را مخفی یا غیرفعال کنید.`
        );
      }
    }

    return next();
  };
}

module.exports = { documentMiddleware };

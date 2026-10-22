'use strict';

const COURSE_UID = 'api::course.course';
const CHAPTER_TYPE = 'course_chapter';

function unavailable(message, status = 409, reason = 'SALE_STOPPED') {
  const error = new Error(message);
  error.status = status;
  error.code = 'CART_UNAVAILABLE';
  error.reason = reason;
  throw error;
}

async function resolveItem(strapi, externalId, { missingStatus = 400 } = {}) {
  const course = await strapi.documents(COURSE_UID).findOne({
    documentId: externalId,
    status: 'published',
    populate: ['chapters'],
  });
  if (course) {
    if (course.isChaptered === true) {
      unavailable('این دوره به‌صورت فصلی فروخته می‌شود؛ فصل موردنظر را انتخاب کنید.');
    }
    return { course, chapter: null, type: 'course', parentExternalId: null };
  }

  const parent = await strapi.db.query(COURSE_UID).findOne({
    where: { chapters: { integrationId: externalId }, publishedAt: { $notNull: true } },
    populate: ['chapters'],
  });
  const chapter = parent?.chapters?.find((item) => item.integrationId === externalId);
  if (!chapter || parent.isChaptered !== true) {
    unavailable('دوره یا فصل منتشرشده و قابل خرید یافت نشد.', missingStatus);
  }
  return { course: parent, chapter, type: CHAPTER_TYPE, parentExternalId: parent.documentId };
}

async function assertOwnership(strapi, buyer, resolved) {
  const { course, chapter } = resolved;
  if (
    (buyer.courses || []).some(
      (item) => item.documentId === course.documentId || Number(item.id ?? item) === course.id,
    )
  ) {
    unavailable('این دوره یا دورهٔ والد فصل قبلاً خریداری شده است.', 409, 'ALREADY_OWNED');
  }
  if (!chapter) {
    return;
  }

  // شناسهٔ عددی فصل قدیمی ممکن است متعلق به نسخهٔ پیش‌نویس همان والد باشد.
  const versions = await strapi.db.query(COURSE_UID).findMany({
    where: { documentId: course.documentId },
    populate: ['chapters'],
  });
  const chapterIds = new Set(
    versions.flatMap((version) =>
      (version.chapters || [])
        .filter((item) => item.integrationId === chapter.integrationId)
        .map((item) => Number(item.id)),
    ),
  );
  chapterIds.add(Number(chapter.id));
  if ((buyer.enrolledChapters || []).some((id) => chapterIds.has(Number(id)))) {
    unavailable('این فصل قبلاً خریداری شده است.', 409, 'ALREADY_OWNED');
  }
}

module.exports = { COURSE_UID, CHAPTER_TYPE, resolveItem, assertOwnership, unavailable };

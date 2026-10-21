'use strict';

const { COURSE_UID, CHAPTER_TYPE } = require('./chapterCatalog');
const LOG_UID = 'api::byemoney-purchase-log.byemoney-purchase-log';
const USER_UID = 'plugin::users-permissions.user';

// این قفل‌ها با تحویل سبد مشترک‌اند؛ قفل رابطه/آرایهٔ JSON در ORM معادل ندارد.
const BUYER_LOCK = 1869767796;
const COURSE_LOCK = 1869767799;
const PURCHASE_LOCK = 1869767800;

function result(purchaseId, httpStatus, status, message) {
  return { httpStatus, response: { success: httpStatus === 200, purchaseId, status, message } };
}

async function confirmChapter(strapi, payload) {
  const purchaseId = payload.purchaseId || payload.dealId;
  const buyerId = payload.buyerExternalUserId || payload.strapiUserId;
  const chapterId = payload.item?.externalId;
  const parentId = payload.item?.parentExternalId;
  if (
    [purchaseId, buyerId, chapterId, parentId].some(
      (value) => typeof value !== 'string' || !value.trim(),
    )
  ) {
    return result(purchaseId || '', 400, 'error', 'شناسهٔ خرید، خریدار، فصل و والد الزامی است.');
  }

  return strapi.db.transaction(async ({ trx }) => {
    // ترتیب قفل‌ها با commit سبد یکسان است تا وبهوک و سبد یکدیگر را متوقف نکنند.
    await trx.raw('SELECT pg_advisory_xact_lock(?, hashtext(?))', [BUYER_LOCK, buyerId]);
    await trx.raw('SELECT pg_advisory_xact_lock(?, hashtext(?))', [COURSE_LOCK, parentId]);
    await trx.raw('SELECT pg_advisory_xact_lock(?, hashtext(?))', [PURCHASE_LOCK, purchaseId]);
    const logs = strapi.db.query(LOG_UID);
    const existing = await logs.findOne({ where: { purchaseId } });
    if (existing) {
      const matches =
        existing.strapiUserId === buyerId &&
        existing.itemType === CHAPTER_TYPE &&
        existing.chapterExternalId === chapterId &&
        existing.parentExternalId === parentId;
      return matches
        ? result(purchaseId, 200, 'already_granted', 'دسترسی این فصل قبلاً ثبت شده است.')
        : result(purchaseId, 409, 'conflict', 'شناسهٔ خرید با قلم یا خریدار قبلی سازگار نیست.');
    }
    const users = strapi.db.query(USER_UID);
    const user = await users.findOne({ where: { documentId: buyerId } });
    if (!user) {
      return result(purchaseId, 404, 'error', 'خریدار یافت نشد.');
    }
    const query = strapi.db.query(COURSE_UID);
    const criteria = { documentId: parentId, chapters: { integrationId: chapterId } };
    const course =
      (await query.findOne({
        where: { ...criteria, publishedAt: { $notNull: true } },
        populate: ['chapters'],
      })) || (await query.findOne({ where: criteria, populate: ['chapters'] }));
    const chapter = course?.chapters?.find((item) => item.integrationId === chapterId);
    if (!chapter) {
      return result(purchaseId, 404, 'error', 'فصل متعلق به والد اعلام‌شده یافت نشد.');
    }
    const enrolled = Array.isArray(user.enrolledChapters) ? user.enrolledChapters : [];
    const ids = [...new Set([...enrolled.map(Number), Number(chapter.id)])];
    await users.update({ where: { id: user.id }, data: { enrolledChapters: ids } });
    await logs.create({
      data: {
        purchaseId,
        strapiUserId: buyerId,
        courseId: parentId,
        itemType: CHAPTER_TYPE,
        chapterExternalId: chapterId,
        parentExternalId: parentId,
        status: 'processed',
      },
    });
    return result(purchaseId, 200, 'granted', 'دسترسی فصل ثبت شد.');
  });
}

module.exports = { confirmChapter };

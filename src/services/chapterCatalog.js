'use strict';

const { calculateChapteredCoursePrice } = require('./chapteredCoursePricing');

const COURSE_UID = 'api::course.course';
const CHAPTER_TYPE = 'course_chapter';
const LOG_UID = 'api::byemoney-purchase-log.byemoney-purchase-log';
const ORDER_UID = 'api::order.order';

function unavailable(message, status = 409, reason = 'SALE_STOPPED') {
  const error = new Error(message);
  error.status = status;
  error.code = 'CART_UNAVAILABLE';
  error.reason = reason;
  throw error;
}

function addId(target, value) {
  const id = Number(value);
  if (Number.isSafeInteger(id) && id > 0) target.add(id);
}

function addUuid(target, value) {
  const text = String(value || '').trim().toLowerCase();
  if (text) target.add(text);
}

// شناسهٔ عددی و UUID فصل‌های پرداخت‌شده از پروفایل، لاگ کیف پول و سفارش درگاه.
async function collectUserOwnedChapters(strapi, buyer, courseDocId) {
  const ids = new Set();
  const uuids = new Set();
  for (const id of buyer?.enrolledChapters || []) addId(ids, id);
  for (const uuid of buyer?.enrolledChapterIntegrationIds || []) addUuid(uuids, uuid);

  const buyerDocId = buyer?.documentId;
  const buyerId = Number(buyer?.id);
  const userIds = [buyerDocId, buyerId ? String(buyerId) : null].filter(Boolean);
  try {
    const logRepo = strapi.db?.query?.(LOG_UID);
    if (logRepo && typeof logRepo.findMany === 'function' && userIds.length > 0) {
      const logs = (await logRepo.findMany({
        where: {
          strapiUserId: userIds.length === 1 ? userIds[0] : { $in: userIds },
          status: 'processed',
          itemType: CHAPTER_TYPE,
        },
      })) || [];
      for (const log of logs) addUuid(uuids, log.chapterExternalId);
    }
  } catch {
    // نبودن مخزن در آزمون یا قطع خواندن، منابع دیگر را حذف نمی‌کند.
  }

  const confirmedStatuses = ['paid', 'confirmed', 'processing', 'shipped', 'delivered'];
  try {
    const orderRepo = strapi.db?.query?.(ORDER_UID);
    if (orderRepo && typeof orderRepo.findMany === 'function' && (buyerId || buyerDocId)) {
      const orders = (await orderRepo.findMany({
        where: {
          user: buyerId ? { id: buyerId } : { documentId: buyerDocId },
          $or: [
            { orderStatus: { $in: confirmedStatuses } },
            { paymentStatus: 'paid' },
          ],
        },
        populate: ['items'],
      })) || [];
      for (const order of orders) {
        if (order.orderStatus === 'canceled' && order.paymentStatus !== 'paid') continue;
        for (const item of order.items || []) {
          if (item.__component !== 'order.course-order-item') continue;
          addId(ids, item.chapterId);
          addUuid(uuids, item.chapterIntegrationId);
        }
      }
    }
  } catch {
    // همانند لاگ.
  }

  // شناسهٔ عددی نسخهٔ پیش‌نویس همان فصل، با UUID نسخهٔ منتشرشده یکی می‌شود.
  try {
    const courseRepo = strapi.db?.query?.(COURSE_UID);
    if (courseRepo && typeof courseRepo.findMany === 'function' && courseDocId) {
      const versions = (await courseRepo.findMany({
        where: { documentId: courseDocId },
        populate: ['chapters'],
      })) || [];
      for (const version of versions) {
        for (const chapter of version.chapters || []) {
          if (ids.has(Number(chapter.id))) addUuid(uuids, chapter.integrationId);
        }
      }
    }
  } catch {
    // نگاشت نسخه اختیاری است؛ UUIDهای ذخیره‌شده همچنان معتبرند.
  }

  return { enrolledChapterIds: [...ids], enrolledChapterUuids: [...uuids] };
}

async function priceOwnedChapters(strapi, buyer, course, isForeign) {
  const owned = await collectUserOwnedChapters(strapi, buyer, course.documentId);
  return calculateChapteredCoursePrice({
    course,
    userEnrolledChapterIds: owned.enrolledChapterIds,
    userEnrolledChapterUuids: owned.enrolledChapterUuids,
    isForeign: isForeign === true,
  });
}

async function quoteChapteredCourse(strapi, buyer, course, isForeign) {
  let pricing;
  try {
    pricing = await priceOwnedChapters(strapi, buyer, course, isForeign);
  } catch (error) {
    unavailable(error.message, 400, 'INVALID_PRICE');
  }
  if (pricing.isFullyOwned) {
    unavailable('این دوره یا تمام فصل‌های آن قبلاً خریداری شده است.', 409, 'ALREADY_OWNED');
  }
  const price = Number(pricing.price);
  const remaining = Number(pricing.remainingBasePrice);
  // قیمت خارجی از قبل مبلغ قابل‌پرداخت است؛ پایهٔ تومان نباید به‌شکل تخفیف نور نشان داده شود.
  const basePrice = isForeign === true ? price : Math.max(remaining, price);
  return { basePrice, price };
}

async function resolveItem(strapi, externalId, { missingStatus = 400 } = {}) {
  const course = await strapi.documents(COURSE_UID).findOne({
    documentId: externalId,
    status: 'published',
    populate: ['chapters'],
  });
  if (course) {
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
  if (!buyer || !resolved?.course) {
    return;
  }
  const { course, chapter } = resolved;
  const courseDocId = course.documentId;
  const courseNumericId = Number(course.id);
  const buyerId = Number(buyer.id);
  const buyerDocId = buyer.documentId;

  // 1. استخراج تمام شناسه‌های عددی دوره در تمام نسخه‌های پیش‌نویس و منتشرشده
  let versions = [];
  try {
    const courseRepo = strapi.db?.query?.(COURSE_UID);
    if (courseRepo && typeof courseRepo.findMany === 'function' && courseDocId) {
      versions = (await courseRepo.findMany({
        where: { documentId: courseDocId },
        populate: ['chapters', 'users_permissions_users'],
      })) || [];
    }
  } catch {
    versions = [];
  }
  const courseVersionIds = new Set(
    (versions || []).map((v) => Number(v.id)).filter(Boolean)
  );
  if (courseNumericId) {
    courseVersionIds.add(courseNumericId);
  }

  // 2. بررسی دسترسی فعال در پروفایل کاربر (رابطهٔ user.courses)
  const userCourses = Array.isArray(buyer.courses) ? buyer.courses : [];
  if (
    userCourses.some((item) => {
      if (!item) return false;
      if (item.documentId && courseDocId && item.documentId === courseDocId) return true;
      const numId = Number(item.id ?? item);
      return Boolean(numId && courseVersionIds.has(numId));
    })
  ) {
    unavailable('این دوره یا دورهٔ والد فصل قبلاً خریداری شده است.', 409, 'ALREADY_OWNED');
  }

  // 3. بررسی رابطهٔ معکوس در دوره (course.users_permissions_users)
  if (
    buyerId &&
    versions.some((v) =>
      (v.users_permissions_users || []).some(
        (u) => Number(u?.id ?? u) === buyerId || (buyerDocId && u?.documentId === buyerDocId)
      )
    )
  ) {
    unavailable('این دوره یا دورهٔ والد فصل قبلاً خریداری شده است.', 409, 'ALREADY_OWNED');
  }

  // 4. بررسی خریدهای ثبت‌شده در لاگ بای‌مانی (api::byemoney-purchase-log)
  let purchaseLogs = [];
  try {
    const logRepo = strapi.db?.query?.('api::byemoney-purchase-log.byemoney-purchase-log');
    if (logRepo && typeof logRepo.findMany === 'function' && (buyerDocId || buyerId)) {
      const userIds = [buyerDocId, buyerId ? String(buyerId) : null].filter(Boolean);
      purchaseLogs = (await logRepo.findMany({
        where: {
          strapiUserId: userIds.length === 1 ? userIds[0] : { $in: userIds },
          status: 'processed',
        },
      })) || [];
    }
  } catch {
    purchaseLogs = [];
  }

  const ownsFullCourseFromLog = purchaseLogs.some(
    (log) =>
      (log.itemType === 'course' || !log.itemType) &&
      (log.courseId === courseDocId || courseVersionIds.has(Number(log.courseId)))
  );
  if (ownsFullCourseFromLog) {
    unavailable('این دوره یا دورهٔ والد فصل قبلاً خریداری شده است.', 409, 'ALREADY_OWNED');
  }

  // 5. بررسی سفارش‌های پرداخت‌شدهٔ قبلی در استراپی (api::order.order)
  const confirmedStatuses = ['paid', 'confirmed', 'processing', 'shipped', 'delivered'];
  let paidOrders = [];
  try {
    const orderRepo = strapi.db?.query?.('api::order.order');
    if (orderRepo && typeof orderRepo.findMany === 'function' && (buyerId || buyerDocId)) {
      const userCriteria = buyerId ? { id: buyerId } : { documentId: buyerDocId };
      paidOrders = (await orderRepo.findMany({
        where: {
          user: userCriteria,
          $or: [
            { orderStatus: { $in: confirmedStatuses } },
            { paymentStatus: 'paid' },
          ],
        },
        populate: ['items'],
      })) || [];
    }
  } catch {
    paidOrders = [];
  }

  const ownsFullCourseFromOrder = paidOrders.some((order) => {
    if (order.orderStatus === 'canceled' && order.paymentStatus !== 'paid') return false;
    return (order.items || []).some((item) => {
      if (item.__component !== 'order.course-order-item') return false;
      if (item.chapterId != null && String(item.chapterId).trim() !== '') return false;
      return (
        (item.courseId && courseVersionIds.has(Number(item.courseId))) ||
        (item.documentId && courseDocId && item.documentId === courseDocId) ||
        (item.slug && course.slug && (item.slug === course.slug || item.slug.split('-chapter-')[0] === course.slug))
      );
    });
  });
  if (ownsFullCourseFromOrder) {
    unavailable('این دوره یا دورهٔ والد فصل قبلاً خریداری شده است.', 409, 'ALREADY_OWNED');
  }

  // دورهٔ فصلی کامل فقط وقتی ممنوع است که خریدار همهٔ فصل‌ها را داشته باشد.
  if (!chapter) {
    if (course.isChaptered === true && Array.isArray(course.chapters) && course.chapters.length > 0) {
      let pricing;
      try {
        pricing = await priceOwnedChapters(strapi, buyer, course, false);
      } catch (error) {
        unavailable(error.message, 400, 'INVALID_PRICE');
      }
      if (pricing.isFullyOwned) {
        unavailable('این دوره یا تمام فصل‌های آن قبلاً خریداری شده است.', 409, 'ALREADY_OWNED');
      }
    }
    return;
  }

  // 6. بررسی‌های اختصاصی مالکیت فصل
  const chapterIds = new Set(
    versions.flatMap((version) =>
      (version.chapters || [])
        .filter((item) => item.integrationId === chapter.integrationId)
        .map((item) => Number(item.id))
    )
  );
  if (chapter.id) {
    chapterIds.add(Number(chapter.id));
  }

  // 6a. دسترسی در enrolledChapters کاربر
  const enrolledChapters = Array.isArray(buyer.enrolledChapters) ? buyer.enrolledChapters : [];
  if (enrolledChapters.some((id) => chapterIds.has(Number(id)))) {
    unavailable('این فصل قبلاً خریداری شده است.', 409, 'ALREADY_OWNED');
  }
  if (
    Array.isArray(buyer.enrolledChapterIntegrationIds) &&
    buyer.enrolledChapterIntegrationIds.includes(chapter.integrationId)
  ) {
    unavailable('این فصل قبلاً خریداری شده است.', 409, 'ALREADY_OWNED');
  }

  // 6b. سابقهٔ لاگ خرید فصل در بای‌مانی
  const ownsChapterFromLog = purchaseLogs.some(
    (log) =>
      log.itemType === CHAPTER_TYPE &&
      (log.chapterExternalId === chapter.integrationId || log.courseId === chapter.integrationId)
  );
  if (ownsChapterFromLog) {
    unavailable('این فصل قبلاً خریداری شده است.', 409, 'ALREADY_OWNED');
  }

  // 6c. سابقهٔ سفارش پرداخت‌شده برای این فصل
  const ownsChapterFromOrder = paidOrders.some((order) => {
    if (order.orderStatus === 'canceled' && order.paymentStatus !== 'paid') return false;
    return (order.items || []).some((item) => {
      if (item.__component !== 'order.course-order-item') return false;
      return item.chapterId != null && chapterIds.has(Number(item.chapterId));
    });
  });
  if (ownsChapterFromOrder) {
    unavailable('این فصل قبلاً خریداری شده است.', 409, 'ALREADY_OWNED');
  }
}

module.exports = {
  COURSE_UID,
  CHAPTER_TYPE,
  resolveItem,
  assertOwnership,
  unavailable,
  collectUserOwnedChapters,
  quoteChapteredCourse,
};

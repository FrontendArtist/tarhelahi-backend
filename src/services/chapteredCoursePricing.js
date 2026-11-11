'use strict';

/**
 * اعتبارسنجی قیمت و تبدیل به عدد معتبر
 */
function toValidPrice(value) {
  if (value == null || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0) {
    throw new Error('قیمت کاتالوگ معتبر نیست.');
  }
  return Number(value);
}

/**
 * بررسی فعال بودن تخفیف کاتالوگ
 */
function isCatalogDiscountActive(record, now = Date.now()) {
  const percent = Number(record?.discountPercent ?? 0);
  const expiry = record?.discountUntil ? new Date(record.discountUntil).getTime() : null;
  if (!Number.isInteger(percent) || percent <= 0 || percent > 100) return false;
  if (expiry !== null && (!Number.isFinite(expiry) || expiry <= now)) return false;
  return true;
}

/**
 * محاسبه قیمت یک کالای منفرد با احتساب تخفیف کاتالوگ
 */
function getDiscountedBasePrice(record, isForeign = false, now = Date.now()) {
  if (isForeign && Number(record?.internationalPrice) > 0) {
    return toValidPrice(record.internationalPrice);
  }
  const base = toValidPrice(record?.price);
  if (!isCatalogDiscountActive(record, now)) return base;
  const percent = Number(record.discountPercent);
  return Math.round(base * (1 - percent / 100));
}

/**
 * تولید خطای 409 اختصاصی ALREADY_OWNED
 */
function createAlreadyOwnedError(message = 'این دوره یا تمام فصل‌های آن قبلاً خریداری شده است.') {
  const err = new Error(message);
  err.status = 409;
  err.statusCode = 409;
  err.code = 'ALREADY_OWNED';
  err.reason = 'ALREADY_OWNED';
  return err;
}

/**
 * محاسبه خالص و مستقل قیمت دوره فصلی
 * 
 * قوانین تجاری توافق‌شده:
 * ۱. اگر تمام فصل‌ها قبلاً خریداری شده باشند: isFullyOwned = true (در checkout منجر به خطای 409 ALREADY_OWNED می‌شود).
 * ۲. اگر کاربر هیچ فصلی نخریده باشد: قیمت کامل پکیج دوره (با تخفیف کاتالوگ اگر موجود باشد).
 * ۳. اگر بخشی از فصل‌ها باقی مانده باشد (چه ۱ فصل و چه چند فصل): درصد تخفیف دوره روی مجموع قیمت فصل‌های باقی‌مانده اعمال می‌شود.
 * ۴. برای کاربر خارجی: تسهیم نسبتی بر مبنای قیمت بین‌المللی.
 * 
 * @param {Object} params
 * @param {Object} params.course دوره با فیلدهای price, discountPercent, discountUntil, isChaptered, chapters
 * @param {Array<number|string>} [params.userEnrolledChapterIds] شناسه‌های عددی فصل‌های خریداری‌شده کاربر
 * @param {Array<string>} [params.userEnrolledChapterUuids] شناسه‌های UUID پایدار فصل‌های خریداری‌شده کاربر
 * @param {boolean} [params.isForeign=false] وضعیت کاربر خارجی
 * @param {number} [params.now=Date.now()] برچسب زمان جاری جهت بررسی انقضای تخفیف
 */
function calculateChapteredCoursePrice({
  course,
  userEnrolledChapterIds = [],
  userEnrolledChapterUuids = [],
  isForeign = false,
  now = Date.now(),
}) {
  if (!course || typeof course !== 'object') {
    throw new Error('اطلاعات دوره برای محاسبه قیمت معتبر نیست.');
  }

  const chapters = Array.isArray(course.chapters) ? course.chapters : [];
  const isChaptered = Boolean(course.isChaptered) && chapters.length > 0;

  // اگر دوره فصلی نباشد، همان قیمت عادی دوره اعمال می‌شود
  if (!isChaptered) {
    const price = getDiscountedBasePrice(course, isForeign, now);
    return {
      price,
      isFullyOwned: false,
      unownedCount: 0,
      ownedCount: 0,
      totalChaptersCount: 0,
      remainingBasePrice: price,
      appliedDiscountPercent: isCatalogDiscountActive(course, now) ? Number(course.discountPercent) : 0,
      unownedChapters: [],
      ownedChapters: [],
    };
  }

  const userIdsSet = new Set((userEnrolledChapterIds || []).map((id) => Number(id)).filter(Boolean));
  const userUuidsSet = new Set(
    (userEnrolledChapterUuids || [])
      .map((u) => String(u || '').trim().toLowerCase())
      .filter(Boolean)
  );

  const ownedChapters = [];
  const unownedChapters = [];

  for (const ch of chapters) {
    const chId = Number(ch.id);
    const chUuid = ch.integrationId ? String(ch.integrationId).trim().toLowerCase() : null;
    const isOwned = (chId && userIdsSet.has(chId)) || (chUuid && userUuidsSet.has(chUuid));
    if (isOwned) {
      ownedChapters.push(ch);
    } else {
      unownedChapters.push(ch);
    }
  }

  const totalChaptersCount = chapters.length;
  const unownedCount = unownedChapters.length;
  const ownedCount = ownedChapters.length;

  // قانون ۱: اگر تمام فصل‌ها از قبل خریده شده باشند
  if (unownedCount === 0) {
    return {
      price: 0,
      isFullyOwned: true,
      unownedCount: 0,
      ownedCount,
      totalChaptersCount,
      remainingBasePrice: 0,
      appliedDiscountPercent: 0,
      unownedChapters: [],
      ownedChapters,
    };
  }

  // قانون ۲: اگر کاربر هیچ فصلی نخریده باشد (خرید دوره کامل از صفر)
  if (ownedCount === 0) {
    const price = getDiscountedBasePrice(course, isForeign, now);
    return {
      price,
      isFullyOwned: false,
      unownedCount,
      ownedCount: 0,
      totalChaptersCount,
      remainingBasePrice: toValidPrice(course.price ?? 0),
      appliedDiscountPercent: isCatalogDiscountActive(course, now) ? Number(course.discountPercent) : 0,
      unownedChapters,
      ownedChapters: [],
    };
  }

  // سناریوی کاربر خارجی
  if (isForeign && Number(course.internationalPrice) > 0) {
    const fullIntl = toValidPrice(course.internationalPrice);
    const foreignPrice = Math.round(fullIntl * (unownedCount / totalChaptersCount));
    return {
      price: foreignPrice,
      isFullyOwned: false,
      unownedCount,
      ownedCount,
      totalChaptersCount,
      remainingBasePrice: foreignPrice,
      appliedDiscountPercent: 0,
      unownedChapters,
      ownedChapters,
    };
  }

  // محاسبه مجموع قیمت پایه فصل‌های باقی‌مانده (تومان)
  const remainingBasePrice = unownedChapters.reduce((sum, ch) => {
    return sum + toValidPrice(ch.price ?? 0);
  }, 0);

  // اعمال درصد تخفیف دوره روی مجموع قیمت فصل‌های باقیمانده (چه ۱ فصل و چه چند فصل باقی مانده باشد)
  const discountActive = isCatalogDiscountActive(course, now);
  const discountPercent = discountActive ? Number(course.discountPercent) : 0;
  const finalPrice = discountActive
    ? Math.round(remainingBasePrice * (1 - discountPercent / 100))
    : remainingBasePrice;

  return {
    price: finalPrice,
    isFullyOwned: false,
    unownedCount,
    ownedCount,
    totalChaptersCount,
    remainingBasePrice,
    appliedDiscountPercent: discountPercent,
    unownedChapters,
    ownedChapters,
  };
}

module.exports = {
  calculateChapteredCoursePrice,
  getDiscountedBasePrice,
  isCatalogDiscountActive,
  createAlreadyOwnedError,
  toValidPrice,
};

'use strict';

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::coupon.coupon', ({ strapi }) => ({
  /**
   * اعتبارسنجی و محاسبه دقیق تخفیف برای سبد خرید
   * @param {string} code - کد تخفیف وارد شده
   * @param {Array} cartItems - اقلام موجود در سبد خرید
   * @param {number} currentTotal - قیمت کل ارسالی از کلاینت
   */
  async validateAndCalculate(code, cartItems = [], currentTotal = 0) {
    if (!code || typeof code !== 'string') {
      return {
        valid: false,
        message: 'لطفاً یک کد تخفیف معتبر وارد کنید.',
      };
    }

    const cleanCode = code.trim();

    // جستجوی کد تخفیف در دیتابیس
    const coupons = await strapi.documents('api::coupon.coupon').findMany({
      filters: {
        code: {
          $eqi: cleanCode, // جستجوی بدون حساسیت به حروف بزرگ و کوچک
        },
      },
      populate: ['products', 'courses'],
    });

    const coupon = coupons?.[0];

    if (!coupon) {
      return {
        valid: false,
        message: 'کد تخفیف وارد شده یافت نشد یا نامعتبر است.',
      };
    }

    // ۱. بررسی وضعیت فعال بودن
    if (coupon.isActive === false) {
      return {
        valid: false,
        message: 'این کد تخفیف در حال حاضر غیرفعال می‌باشد.',
      };
    }

    const now = new Date();

    // ۲. بررسی تاریخ شروع
    if (coupon.startDate && new Date(coupon.startDate) > now) {
      return {
        valid: false,
        message: 'مهلت استفاده از این کد تخفیف هنوز شروع نشده است.',
      };
    }

    // ۳. بررسی تاریخ انقضا
    if (coupon.expiresAt && new Date(coupon.expiresAt) < now) {
      return {
        valid: false,
        message: 'مهلت استفاده از این کد تخفیف به پایان رسیده است (منقضی شده است).',
      };
    }

    // ۴. بررسی سقف تعداد دفعات استفاده
    if (
      typeof coupon.maxUsage === 'number' &&
      coupon.maxUsage > 0 &&
      (coupon.usedCount || 0) >= coupon.maxUsage
    ) {
      return {
        valid: false,
        message: 'ظرفیت استفاده از این کد تخفیف به پایان رسیده است.',
      };
    }

    // ۵. محاسبه جمع اقلام سبد خرید و بررسی اقلام واجد شرایط
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return {
        valid: false,
        message: 'سبد خرید شما خالی است.',
      };
    }

    let calculatedCartTotal = 0;
    let eligibleSubtotal = 0;
    const eligibleItemIds = [];

    // استخراج تمام شناسه‌ها، documentIdها و اسلاگ‌های دوره‌ها و محصولات مشخص‌شده در کد تخفیف
    const couponProductIds = [];
    const couponProductDocIds = [];
    const couponProductSlugs = [];

    if (Array.isArray(coupon.products)) {
      for (const p of coupon.products) {
        if (p.id != null) couponProductIds.push(String(p.id));
        if (p.documentId) couponProductDocIds.push(String(p.documentId));
        if (p.slug) couponProductSlugs.push(String(p.slug).toLowerCase().trim());
      }
    }

    const couponCourseIds = [];
    const couponCourseDocIds = [];
    const couponCourseSlugs = [];

    if (Array.isArray(coupon.courses)) {
      for (const c of coupon.courses) {
        if (c.id != null) couponCourseIds.push(String(c.id));
        if (c.documentId) couponCourseDocIds.push(String(c.documentId));
        if (c.slug) couponCourseSlugs.push(String(c.slug).toLowerCase().trim());
      }
    }

    for (const item of cartItems) {
      const itemQty = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
      const itemPrice = Number(item.price) || 0;
      const itemTotal = itemPrice * itemQty;
      calculatedCartTotal += itemTotal;

      const itemIdStr = String(item.id || '');
      const itemCourseIdStr = String(item.courseId || '');
      const itemDocIdStr = String(item.documentId || '');
      const itemSlugStr = String(item.slug || '').toLowerCase().trim();

      // استخراج اسلاگ دوره والد در صورت وجود فصل (مثلاً khak-be-aflak-chapter-1 -> khak-be-aflak)
      let parentCourseSlug = '';
      if (itemSlugStr.includes('-chapter-')) {
        parentCourseSlug = itemSlugStr.split('-chapter-')[0].trim();
      } else if (itemSlugStr) {
        parentCourseSlug = itemSlugStr;
      }

      let isItemEligible = false;

      if (item.type === 'course' || item.type === 'chapter') {
        if (coupon.appliesToAllCourses) {
          isItemEligible = true;
        } else {
          // بررسی تطابق با دوره والد بر اساس ID، DocumentId یا Slug
          const matchesId =
            couponCourseIds.includes(itemIdStr) ||
            couponCourseIds.includes(itemCourseIdStr) ||
            couponCourseIds.includes(itemIdStr.replace(/^chapter-/, ''));

          const matchesDocId =
            couponCourseDocIds.includes(itemIdStr) ||
            couponCourseDocIds.includes(itemCourseIdStr) ||
            couponCourseDocIds.includes(itemDocIdStr);

          const matchesSlug =
            (itemSlugStr && couponCourseSlugs.includes(itemSlugStr)) ||
            (parentCourseSlug && couponCourseSlugs.includes(parentCourseSlug));

          if (matchesId || matchesDocId || matchesSlug) {
            isItemEligible = true;
          }
        }
      } else if (item.type === 'light_topup') {
        // شارژ نور در صورت فعال بودن تخفیف همگانی محصولات و دوره‌ها
        if (coupon.appliesToAllProducts && coupon.appliesToAllCourses) {
          isItemEligible = true;
        }
      } else {
        // محصول فیزیکی
        if (coupon.appliesToAllProducts) {
          isItemEligible = true;
        } else {
          const matchesId =
            couponProductIds.includes(itemIdStr) ||
            couponProductIds.includes(String(item.productId || ''));

          const matchesDocId =
            couponProductDocIds.includes(itemIdStr) ||
            couponProductDocIds.includes(itemDocIdStr);

          const matchesSlug =
            itemSlugStr && couponProductSlugs.includes(itemSlugStr);

          if (matchesId || matchesDocId || matchesSlug) {
            isItemEligible = true;
          }
        }
      }

      if (isItemEligible) {
        eligibleSubtotal += itemTotal;
        eligibleItemIds.push(item.id);
      }
    }

    // ۶. بررسی حداقل مبلغ سفارش
    if (
      typeof coupon.minOrderAmount === 'number' &&
      coupon.minOrderAmount > 0 &&
      calculatedCartTotal < coupon.minOrderAmount
    ) {
      const formattedMin = new Intl.NumberFormat('fa-IR').format(coupon.minOrderAmount);
      return {
        valid: false,
        message: `حداقل مبلغ سفارش برای استفاده از این کد تخفیف ${formattedMin} تومان می‌باشد.`,
      };
    }

    // ۷. بررسی آیا هیچ آیتمی واجد شرایط بود یا خیر
    if (eligibleSubtotal <= 0) {
      return {
        valid: false,
        message: 'این کد تخفیف برای محصولات یا دوره‌های موجود در سبد خرید شما قابل اعمال نیست.',
      };
    }

    // ۸. محاسبه مبلغ تخفیف
    let discountAmount = 0;
    const discountVal = Number(coupon.discountValue) || 0;

    if (coupon.discountType === 'percentage') {
      discountAmount = Math.round((eligibleSubtotal * discountVal) / 100);

      // بررسی سقف تخفیف درصدی در صورت تعریف شدن
      if (
        typeof coupon.maxDiscountAmount === 'number' &&
        coupon.maxDiscountAmount > 0 &&
        discountAmount > coupon.maxDiscountAmount
      ) {
        discountAmount = coupon.maxDiscountAmount;
      }
    } else {
      // مبلغ ثابت (fixed)
      discountAmount = Math.min(discountVal, eligibleSubtotal);
    }

    // جلوگیری از تخفیف بیشتر از کل فاکتور
    discountAmount = Math.min(discountAmount, calculatedCartTotal);

    const finalPayable = Math.max(0, calculatedCartTotal - discountAmount);

    return {
      valid: true,
      documentId: coupon.documentId,
      code: coupon.code,
      title: coupon.title || 'کد تخفیف',
      discountType: coupon.discountType,
      discountValue: discountVal,
      discountAmount,
      originalTotalPrice: calculatedCartTotal,
      finalTotalPrice: finalPayable,
      eligibleItemIds,
      message: 'کد تخفیف با موفقیت اعمال گردید.',
    };
  },

  /**
   * افزایش شمارنده تعداد دفعات استفاده پس از ثبت موفق سفارش
   */
  async incrementUsedCount(code) {
    if (!code) return;
    try {
      const coupons = await strapi.documents('api::coupon.coupon').findMany({
        filters: { code: { $eqi: code.trim() } },
      });
      const coupon = coupons?.[0];
      if (coupon) {
        await strapi.documents('api::coupon.coupon').update({
          documentId: coupon.documentId,
          data: {
            usedCount: (Number(coupon.usedCount) || 0) + 1,
          },
        });
      }
    } catch (err) {
      console.error('Error incrementing coupon usedCount:', err);
    }
  },
}));

'use strict';

const { allocateDiscount } = require('../../../services/coupon-allocation');

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
    const eligibleRows = [];

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

    for (let index = 0; index < cartItems.length; index++) {
      const item = cartItems[index];
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
            (item.type === 'course' && couponCourseIds.includes(itemIdStr)) ||
            couponCourseIds.includes(itemCourseIdStr);

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
        // کوپن خرید روی شارژ نور اعمال نمی‌شود.
        isItemEligible = false;
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
        eligibleRows.push({
          index,
          item,
          total: itemTotal,
        });
      }
    }

    // ۶. بررسی حداقل مبلغ سفارش (به واحد نور)
    if (
      typeof coupon.minOrderAmount === 'number' &&
      coupon.minOrderAmount > 0 &&
      calculatedCartTotal < coupon.minOrderAmount
    ) {
      const formattedMin = new Intl.NumberFormat('fa-IR').format(coupon.minOrderAmount);
      return {
        valid: false,
        message: `حداقل مبلغ سفارش برای استفاده از این کد تخفیف ${formattedMin} نور می‌باشد.`,
      };
    }

    // ۷. بررسی آیا هیچ آیتمی واجد شرایط بود یا خیر
    if (eligibleSubtotal <= 0) {
      return {
        valid: false,
        message: 'این کد تخفیف برای محصولات یا دوره‌های موجود در سبد خرید شما قابل اعمال نیست.',
      };
    }

    // کوپن عمومی یک بار روی جمع اقلام مشمول گرد می‌شود؛ کوپن اختصاصی ردیفی است.
    const discountVal = Number(coupon.discountValue);
    if (!Number.isFinite(discountVal) || discountVal < 0 ||
        (coupon.discountType === 'percentage' && discountVal > 100)) {
      return { valid: false, message: 'مقدار تخفیف معتبر نیست.' };
    }

    const general = coupon.appliesToAllCourses === true || coupon.appliesToAllProducts === true;
    let itemDiscountsByIndex;
    if (coupon.discountType === 'percentage' && !general) {
      itemDiscountsByIndex = new Map(eligibleRows.map(row => [row.index, Math.floor(row.total * discountVal / 100)]));
    } else {
      const amount = coupon.discountType === 'percentage' ? eligibleSubtotal * discountVal / 100 : discountVal;
      itemDiscountsByIndex = allocateDiscount(eligibleRows.map(row => ({ id: row.index, total: row.total })), amount);
    }
    const calculatedDiscount = [...itemDiscountsByIndex.values()].reduce((sum, value) => sum + value, 0);
    if (Number(coupon.maxDiscountAmount) > 0 && calculatedDiscount > Number(coupon.maxDiscountAmount)) {
      itemDiscountsByIndex = allocateDiscount(eligibleRows.map(row => ({ id: row.index, total: itemDiscountsByIndex.get(row.index) || 0 })), Number(coupon.maxDiscountAmount));
    }
    // قیمت نهایی هر ردیف از کم‌کردن تخفیف ردیف از قیمت پایه به دست می‌آید؛
    // جمع سبد فقط جمع قیمت نهایی ردیف‌هاست و دوباره گرد نمی‌شود.
    let finalPayable = 0;
    let totalDiscountAmount = 0;

    for (let index = 0; index < cartItems.length; index++) {
      const item = cartItems[index];
      const itemQty = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
      const itemPrice = Number(item.price) || 0;
      const itemTotal = itemPrice * itemQty;
      const rowDiscount = itemDiscountsByIndex.get(index) || 0;
      const rowFinalPrice = Math.max(0, itemTotal - rowDiscount);

      finalPayable += rowFinalPrice;
      totalDiscountAmount += rowDiscount;
    }

    return {
      valid: true,
      documentId: coupon.documentId,
      code: coupon.code,
      title: coupon.title || 'کد تخفیف',
      discountType: coupon.discountType,
      discountValue: discountVal,
      discountAmount: totalDiscountAmount,
      originalTotalPrice: calculatedCartTotal,
      finalTotalPrice: finalPayable,
      eligibleItemIds,
      itemDiscounts: eligibleRows.map(row => ({
        id: row.item.id,
        index: row.index,
        discountAmount: itemDiscountsByIndex.get(row.index) || 0,
      })),
      message: 'کد تخفیف با موفقیت اعمال گردید.',
    };
  },

  /**
   * بررسی و مصرف اتومیک کد تخفیف جهت جلوگیری از Race Condition و دابل-اسپند
   * @param {string} code - کد تخفیف
   */
  async consumeCoupon(code) {
    if (!code || typeof code !== 'string') {
      return { success: false, message: 'کد تخفیف ارسال نشده است.' };
    }
    const cleanCode = code.trim();

    try {
      return await strapi.db.transaction(async ({ trx }) => {
        // آخرین ظرفیت کوپن میان مصرف‌های هم‌زمان فقط یک بار استفاده می‌شود.
        const metadata = strapi.db.metadata.get('api::coupon.coupon');
        await trx(metadata.tableName)
          .whereRaw('LOWER(??) = LOWER(?)', [metadata.attributes.code.columnName, cleanCode])
          .orderBy('id').forUpdate().select('id');
        const coupons = await strapi.db.query('api::coupon.coupon').findMany({
          where: { code: { $eqi: cleanCode } },
        });
        const coupon = coupons?.[0];

        if (!coupon) {
          return { success: false, message: 'کد تخفیف یافت نشد.' };
        }

        if (coupon.isActive === false) {
          return { success: false, message: 'این کد تخفیف غیرفعال می‌باشد.' };
        }

        const now = new Date();
        if (coupon.startDate && new Date(coupon.startDate) > now) {
          return { success: false, message: 'مهلت استفاده از این کد تخفیف هنوز شروع نشده است.' };
        }

        if (coupon.expiresAt && new Date(coupon.expiresAt) < now) {
          return { success: false, message: 'مهلت استفاده از این کد تخفیف به پایان رسیده است.' };
        }

        const currentUsed = Number(coupon.usedCount) || 0;
        if (
          typeof coupon.maxUsage === 'number' &&
          coupon.maxUsage > 0 &&
          currentUsed >= coupon.maxUsage
        ) {
          return { success: false, message: 'ظرفیت استفاده از این کد تخفیف به پایان رسیده است.' };
        }

        await strapi.db.query('api::coupon.coupon').update({
          where: { id: coupon.id },
          data: {
            usedCount: currentUsed + 1,
          },
        });

        return {
          success: true,
          code: coupon.code,
          usedCount: currentUsed + 1,
          message: 'کد تخفیف با موفقیت مصرف گردید.',
        };
      });
    } catch (err) {
      console.error('[consumeCoupon Error]:', err);
      return { success: false, message: `خطا در پردازش کد تخفیف: ${err.message}` };
    }
  },

  /**
   * افزایش شمارنده تعداد دفعات استفاده پس از ثبت موفق سفارش (همگام با متد اتومیک)
   */
  async incrementUsedCount(code) {
    return this.consumeCoupon(code);
  },
}));

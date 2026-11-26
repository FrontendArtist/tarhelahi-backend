'use strict';

/**
 * Order Lifecycle Hooks for Strapi v5
 * Automatically connects courses & enrolledChapters to the User when order status becomes paid.
 * Updates relations from the Course (Owner) side to ensure they display in the Strapi Admin UI.
 * Sends SMS via SMS.ir if any purchased course has a telegramLink.
 */

const smsService = require('../../../../services/smsService');
const phoneUtils = require('../../../../utils/phoneUtils');
const { toCode } = require('../../../../services/financialEnums');

async function syncUserPurchases(orderIdentifier) {
  try {
    if (!orderIdentifier) return;

    let order = null;
    const isNumeric =
      typeof orderIdentifier === 'number' ||
      (typeof orderIdentifier === 'string' && /^\d+$/.test(orderIdentifier));

    // 1. Load order (try strapi.documents first if string documentId, then numeric id, then db.query)
    if (typeof strapi.documents === 'function' && typeof orderIdentifier === 'string' && !/^\d+$/.test(orderIdentifier)) {
      order = await strapi.documents('api::order.order').findOne({
        documentId: orderIdentifier,
        populate: ['user', 'items'],
      });
    }

    if (!order && isNumeric) {
      order = await strapi.db.query('api::order.order').findOne({
        where: { id: Number(orderIdentifier) },
        populate: ['user', 'items'],
      });
    }

    if (!order) {
      const orders = await strapi.db.query('api::order.order').findMany({
        where: { document_id: String(orderIdentifier) },
        populate: ['user', 'items'],
        orderBy: { id: 'asc' },
      });
      order = orders?.[0] || null;
    }

    if (!order || !order.user) return;

    // 2. Check if paid or confirmed
    const confirmedStatuses = ['paid', 'confirmed', 'processing', 'shipped', 'delivered'];
    const normalizedOrderStatus = toCode('api::order.order', 'orderStatus', order.orderStatus);
    const normalizedPaymentStatus = toCode('api::order.order', 'paymentStatus', order.paymentStatus);
    const orderStatusPaid =
      typeof normalizedOrderStatus === 'string' && confirmedStatuses.includes(normalizedOrderStatus.trim().toLowerCase());
    const paymentStatusPaid =
      typeof normalizedPaymentStatus === 'string' && normalizedPaymentStatus.trim().toLowerCase() === 'paid';

    if (!orderStatusPaid && !paymentStatusPaid) return;

    const userId = order.user.id;
    const items = order.items || [];

    const courseIdsToConnect = new Set();
    const chapterIdsToConnect = new Set();
    const chapterIntegrationIdsToConnect = new Set();
    const coursesToCheck = new Map();

    for (const item of items) {
      // اسلاگ یک محصول نباید به‌اشتباه دسترسی دورهٔ هم‌نام را ایجاد کند.
      if (item.__component !== 'order.course-order-item') continue;

      // Chapter purchase
      if (item.chapterId || item.chapterIntegrationId) {
        if (item.chapterId) {
          chapterIdsToConnect.add(Number(item.chapterId));
        }
        if (item.chapterIntegrationId) {
          chapterIntegrationIdsToConnect.add(String(item.chapterIntegrationId).toLowerCase());
        }

        if (item.courseId) {
          const cId = Number(item.courseId);
          if (cId && !coursesToCheck.has(cId)) {
            const parentCourse = await strapi.db.query('api::course.course').findOne({
              where: { id: cId },
            });
            if (parentCourse) coursesToCheck.set(cId, parentCourse);
          }
        }
      } else if (item.courseId || item.slug) {
        // Full course purchase
        let targetCourse = null;

        if (item.courseId && (typeof item.courseId === 'number' || /^\d+$/.test(String(item.courseId)))) {
          const courses = await strapi.db.query('api::course.course').findMany({
            where: {
              $or: [
                { id: Number(item.courseId) },
              ],
              published_at: { $notNull: true },
            },
          });
          targetCourse = courses?.[0] || null;

          if (!targetCourse) {
            targetCourse = await strapi.db.query('api::course.course').findOne({
              where: { id: Number(item.courseId) },
            });
          }
        }

        if (!targetCourse && item.slug) {
          const cleanSlug = item.slug.includes('-chapter-')
            ? item.slug.split('-chapter-')[0]
            : item.slug;
          const courses = await strapi.db.query('api::course.course').findMany({
            where: {
              slug: cleanSlug,
              published_at: { $notNull: true },
            },
          });
          targetCourse = courses?.[0] || null;

          if (!targetCourse) {
            targetCourse = await strapi.db.query('api::course.course').findOne({
              where: { slug: cleanSlug },
            });
          }
        }

        if (targetCourse && targetCourse.id) {
          courseIdsToConnect.add(targetCourse.id);
          coursesToCheck.set(targetCourse.id, targetCourse);

          // در صورت خرید کل دوره، تمامی فصل‌های آن نیز به دسترسی‌های کاربر متصل می‌شوند
          try {
            const courseWithChapters = await strapi.db.query('api::course.course').findOne({
              where: { id: targetCourse.id },
              populate: ['chapters'],
            });
            if (Array.isArray(courseWithChapters?.chapters)) {
              for (const ch of courseWithChapters.chapters) {
                if (ch.id) chapterIdsToConnect.add(Number(ch.id));
                if (ch.integrationId) chapterIntegrationIdsToConnect.add(String(ch.integrationId).toLowerCase());
              }
            }
          } catch (err) {
            console.error('[Order Lifecycle] Error populating course chapters for bulk purchase:', err.message);
          }
        }
      }
    }

    // 3. Fetch user
    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: userId },
    });

    if (!user) return;

    // 4. Sync courses relation atomically via connect (no full-list overwrite race)
    if (courseIdsToConnect.size > 0) {
      for (const courseId of courseIdsToConnect) {
        await strapi.db.query('api::course.course').update({
          where: { id: courseId },
          data: {
            users_permissions_users: { connect: [userId] },
          },
        });
      }
      console.log(`[Order Lifecycle] ✅ Connected courses [${Array.from(courseIdsToConnect)}] to user ${userId} from Course (Owner) side`);
    }

    // 5. Sync enrolledChapters and enrolledChapterIntegrationIds JSON fields inside a row-locked transaction
    if (chapterIdsToConnect.size > 0 || chapterIntegrationIdsToConnect.size > 0) {
      const applyChapterMerge = async () => {
        const freshUser = await strapi.db.query('plugin::users-permissions.user').findOne({
          where: { id: userId },
        });
        if (!freshUser) return null;

        const existingChapters = Array.isArray(freshUser.enrolledChapters)
          ? freshUser.enrolledChapters.map(Number).filter(Boolean)
          : [];
        const newChapterIds = Array.from(chapterIdsToConnect);
        const mergedChapters = [...new Set([...existingChapters, ...newChapterIds])];

        const existingUuids = Array.isArray(freshUser.enrolledChapterIntegrationIds)
          ? freshUser.enrolledChapterIntegrationIds.map((id) => String(id).toLowerCase())
          : [];
        const newUuids = Array.from(chapterIntegrationIdsToConnect);
        const mergedUuids = [...new Set([...existingUuids, ...newUuids])];

        await strapi.db.query('plugin::users-permissions.user').update({
          where: { id: userId },
          data: {
            enrolledChapters: mergedChapters,
            enrolledChapterIntegrationIds: mergedUuids,
          },
        });

        return { mergedChapters, mergedUuids };
      };

      let mergeResult = null;
      if (typeof strapi.db.transaction === 'function') {
        mergeResult = await strapi.db.transaction(async ({ trx }) => {
          if (trx) {
            const userMeta = strapi.db.metadata?.get?.('plugin::users-permissions.user');
            const tableName = userMeta?.tableName || 'up_users';
            await trx(tableName).where({ id: userId }).forUpdate().select('id');
          }
          return applyChapterMerge();
        });
      } else {
        mergeResult = await applyChapterMerge();
      }

      if (mergeResult) {
        console.log(
          `[Order Lifecycle] ✅ Connected chapters [${mergeResult.mergedChapters}] and UUIDs [${mergeResult.mergedUuids}] to user ${userId}`
        );
      }
    }

    console.log(`[Order Lifecycle] ✅ Synced user ${userId} purchases successfully`);

    // 6. Send Telegram link SMS for enrolled courses that have telegramLink
    if (coursesToCheck.size > 0) {
      await sendTelegramSmsForEnrolledCourses(order, user, coursesToCheck);
    }
  } catch (error) {
    console.error('[Order Lifecycle Error]:', error.message || error);
  }
}

/**
 * بررسی و ارسال پیامک اطلاع‌رسانی لینک تلگرام به کاربر
 */
async function sendTelegramSmsForEnrolledCourses(order, user, coursesMap) {
  try {
    const rawPhone = order.phone || user?.phoneNumber || (order.user && order.user.phoneNumber);
    const cleanPhone = phoneUtils.standardizePhoneNumber(rawPhone);

    if (!cleanPhone) {
      console.warn(`[Order Lifecycle] ⚠️ Cannot send Telegram SMS for order ${order.id}: no valid phone number found.`);
      return;
    }

    if (phoneUtils.isTestPhoneNumber(rawPhone)) {
      console.log(`[Order Lifecycle] ℹ️ Test phone number detected (${rawPhone}), skipping real SMS.`);
      return;
    }

    let notesUpdated = false;
    let currentNotes = order.notes || '';

    for (const [courseId, course] of coursesMap.entries()) {
      const telegramLink = (course.telegramLink || course.telegram_link || '').trim();
      if (!telegramLink) {
        continue;
      }

      const sentTag = `[TELEGRAM_SMS_SENT:${courseId}]`;
      if (currentNotes.includes(sentTag)) {
        console.log(`[Order Lifecycle] Telegram SMS already sent for course ${courseId} on order ${order.id}. Skipping.`);
        continue;
      }

      try {
        console.log(`[Order Lifecycle] 🚀 Sending Telegram group SMS to ${cleanPhone} for course "${course.title}" (${course.slug})...`);
        await smsService.sendCourseTelegramLinkSms(cleanPhone, {
          courseTitle: course.title,
          courseSlug: course.slug,
          telegramLink: telegramLink,
        });

        currentNotes = currentNotes ? `${currentNotes}\n${sentTag}` : sentTag;
        notesUpdated = true;
        console.log(`[Order Lifecycle] ✅ Telegram group SMS sent successfully to ${cleanPhone} for course ${courseId}`);
      } catch (smsError) {
        console.error(`[Order Lifecycle] ❌ Failed to send Telegram SMS for course ${courseId}:`, smsError.message);
      }
    }

    if (notesUpdated) {
      order.notes = currentNotes;
      await strapi.db.query('api::order.order').update({
        where: { id: order.id },
        data: { notes: currentNotes },
      });
    }
  } catch (error) {
    console.error('[Order Lifecycle sendTelegramSmsForEnrolledCourses Error]:', error.message || error);
  }
}

module.exports = {
  async afterCreate(event) {
    if (require('../../../../services/physicalStockMiddleware').managedOrder.getStore()) {
      return;
    }
    try {
      const { result } = event;
      const targetId = result?.id || result?.documentId;
      if (targetId) {
        // مطابق D08 (LOG-007): سفارش جدید خارج از سبد بای‌مانی نباید دسترسی دوره یا فصل به کاربر بدهد.
        await strapi.service('api::notification.notification')?.syncOrderNotification(targetId);
      }
    } catch (err) {
      console.error('[afterCreate Error]:', err.message || err);
    }
  },

  async afterUpdate(event) {
    if (require('../../../../services/physicalStockMiddleware').managedOrder.getStore()) {
      return;
    }
    try {
      const { result } = event;
      const targetId = result?.id || result?.documentId;
      if (targetId) {
        // موجودی فقط در سرویس رزرو و middleware تراکنشی سفارش مدیریت می‌شود.
        await syncUserPurchases(targetId);
        await strapi.service('api::notification.notification')?.syncOrderNotification(targetId);
      }
    } catch (err) {
      console.error('[afterUpdate Error]:', err.message || err);
    }
  },
};

'use strict';

/**
 * notification service
 */

const { createCoreService } = require('@strapi/strapi').factories;

const NOTIFICATION_UID = 'api::notification.notification';

const SILENT_CANCELLATION_REASONS = [
  'لغو خودکار به دلیل ثبت فرآیند خرید جدید',
  'جایگزین‌شده با سفارش جدید',
  'لغو به دلیل حذف دستی تمام اقلام سفارش از سبد خرید',
];

async function findRecordWithUser(strapi, uid, identifier, extraPopulate = []) {
  if (!identifier) return null;
  const populate = Array.from(new Set(['user', ...extraPopulate]));
  const isNumeric =
    typeof identifier === 'number' ||
    (typeof identifier === 'string' && /^\d+$/.test(identifier));

  let record = null;

  if (typeof strapi.documents === 'function' && typeof identifier === 'string' && !isNumeric) {
    try {
      record = await strapi.documents(uid).findOne({
        documentId: identifier,
        populate,
      });
    } catch {
      record = null;
    }
  }

  if (!record && isNumeric) {
    record = await strapi.db.query(uid).findOne({
      where: { id: Number(identifier) },
      populate,
    });
  }

  if (!record) {
    const records = await strapi.db.query(uid).findMany({
      where: { document_id: String(identifier) },
      populate,
      orderBy: { id: 'desc' },
    });
    record = records?.[0] || null;
  }

  return record;
}

module.exports = createCoreService(NOTIFICATION_UID, ({ strapi }) => ({
  /**
   * ثبت اعلان جدید برای کاربر (با جلوگیری از تکرار eventKey و خوانده کردن اعلان‌های قدیمی‌تر همان موجودیت)
   */
  async upsertNotificationForUser({
    userId,
    type,
    title,
    message,
    hint = null,
    link = '',
    rawId = '',
    eventKey = '',
  }) {
    if (!userId || !message) return null;

    const numericUserId = Number(userId);
    if (!Number.isSafeInteger(numericUserId) || numericUserId <= 0) return null;

    // ۱. اگر دقیقاً همین رویداد (eventKey) با همین پیام به عنوان آخرین اعلان برای این rawId ثبت شده، دوباره نساز
    if (eventKey) {
      const existingSameEvent = await strapi.db.query(NOTIFICATION_UID).findMany({
        where: {
          users_permissions_user: { id: numericUserId },
          eventKey: String(eventKey),
        },
        orderBy: { id: 'desc' },
        limit: 1,
      });

      if (existingSameEvent && existingSameEvent.length > 0) {
        const latest = existingSameEvent[0];
        if (latest.notifMessage === message) {
          return latest;
        }
      }
    }

    // ۲. اعلان‌های خوانده‌نشدهٔ قبلی مربوط به همین سفارش یا پیام (rawId) را خوانده‌شده علامت بزن
    // تا کاربر همزمان دو وضعیت متناقض (مثلاً «در حال بررسی» و «تایید شد») نبیند
    if (rawId) {
      const prevUnread = await strapi.db.query(NOTIFICATION_UID).findMany({
        where: {
          users_permissions_user: { id: numericUserId },
          rawId: String(rawId),
          isRead: false,
        },
        select: ['id'],
      });

      if (prevUnread && prevUnread.length > 0) {
        await strapi.db.query(NOTIFICATION_UID).updateMany({
          where: {
            id: { $in: prevUnread.map((n) => n.id) },
          },
          data: { isRead: true },
        });
      }
    }

    // ۳. ایجاد رکورد اعلان جدید
    const data = {
      title: title || 'اعلان جدید',
      notifMessage: message,
      hint: hint || null,
      type: type || 'system_alert',
      link: link || '',
      isRead: false,
      rawId: rawId ? String(rawId) : null,
      eventKey: eventKey ? String(eventKey) : null,
      users_permissions_user: numericUserId,
    };

    if (typeof strapi.documents === 'function') {
      return await strapi.documents(NOTIFICATION_UID).create({
        data,
      });
    }

    return await strapi.db.query(NOTIFICATION_UID).create({
      data,
    });
  },

  /**
   * بررسی وضعیت سفارش و ثبت خودکار اعلان برای کاربر
   */
  async syncOrderNotification(orderIdentifier) {
    try {
      const order = await findRecordWithUser(strapi, 'api::order.order', orderIdentifier, ['items']);
      if (!order || !order.user?.id) return null;

      const userId = order.user.id;
      const docId = order.documentId;
      const numId = order.id;
      const rawId = String(docId || numId);

      const oStatus = String(order.orderStatus || '').trim().toLowerCase();
      const pStatus = String(order.paymentStatus || '').trim().toLowerCase();
      const paymentMethod = String(order.paymentMethod || '').trim().toLowerCase();
      const rejectionReason = String(order.rejectionReason || '').trim();

      // نادیده گرفتن لغوهای سیستمی سبد خرید
      if (SILENT_CANCELLATION_REASONS.some((reason) => rejectionReason.includes(reason))) {
        return null;
      }

      const isOnlinePayment = paymentMethod === 'online';
      const isPaid =
        oStatus === 'paid' ||
        pStatus === 'paid' ||
        ['confirmed', 'shipped', 'delivered'].includes(oStatus);

      const isPendingVerification =
        !isPaid &&
        (pStatus === 'pending_verification' || (isOnlinePayment && pStatus === 'processing'));

      const isOnlineFailedOrCanceled =
        !isPaid &&
        isOnlinePayment &&
        (oStatus === 'canceled' ||
          oStatus === 'cancelled' ||
          pStatus === 'failed' ||
          (rejectionReason && !isPendingVerification));

      const isCardRejected =
        !isPaid &&
        !isOnlinePayment &&
        (oStatus === 'canceled' ||
          oStatus === 'cancelled' ||
          oStatus === 'rejected' ||
          oStatus === 'رد شده' ||
          pStatus === 'failed' ||
          pStatus === 'rejected' ||
          Boolean(rejectionReason));

      if (!isPaid && !isOnlineFailedOrCanceled && !isPendingVerification && !isCardRejected) {
        return null;
      }

      let type = 'confirmed';
      if (isPaid) {
        type = 'confirmed';
      } else if (isPendingVerification) {
        type = 'pending_verification';
      } else if (isOnlineFailedOrCanceled) {
        type = 'payment_failed';
      } else if (isCardRejected) {
        type = 'rejected';
      }

      const items = Array.isArray(order.items) ? order.items : [];
      const firstItemTitle = items[0]?.title || items[0]?.name || null;
      const itemsCount = items.length;

      let title = '';
      let message = '';
      let link = '';
      let hint = null;

      if (type === 'confirmed') {
        title = isOnlinePayment ? 'پرداخت با موفقیت انجام شد 🎉' : 'سفارش شما تایید شد 🎉';
        link = '/profile/purchases';
        if (firstItemTitle) {
          if (itemsCount > 1) {
            message = `دسترسی به «${firstItemTitle}» و ${itemsCount - 1} مورد دیگر فعال شد.`;
          } else {
            message = `دسترسی شما به «${firstItemTitle}» فعال شد.`;
          }
        } else {
          message = `سفارش شماره #${numId} با موفقیت تایید شد و دسترسی شما فعال گردید.`;
        }
      } else if (type === 'payment_failed') {
        const isCanceledByUser =
          rejectionReason.includes('کاربر لغو') || rejectionReason.toLowerCase().includes('cancel');
        const isVpnIssue =
          rejectionReason.includes('فیلترشکن') || rejectionReason.toLowerCase().includes('vpn');

        if (isCanceledByUser) {
          title = 'پرداخت آنلاین لغو شد ⚠️';
        } else if (isVpnIssue) {
          title = 'خطای اتصال به درگاه (VPN) ⚠️';
        } else {
          title = 'پرداخت آنلاین ناموفق بود ⚠️';
        }

        link = '/cart';

        if (firstItemTitle) {
          if (itemsCount > 1) {
            message = `پرداخت آنلاین «${firstItemTitle}» و ${itemsCount - 1} مورد دیگر تکمیل نشد. اقلام در سبد خرید شما محفوظ است.`;
          } else {
            message = `پرداخت آنلاین «${firstItemTitle}» تکمیل نشد. اقلام در سبد خرید شما محفوظ است.`;
          }
        } else if (rejectionReason) {
          message = `پرداخت سفارش شماره #${numId} انجام نشد (${rejectionReason}). اقلام در سبد خرید محفوظ است.`;
        } else {
          message = `پرداخت سفارش شماره #${numId} در درگاه انجام نشد. در سبد خرید می‌توانید خرید را تکمیل کنید.`;
        }

        hint =
          'اگر مبلغ از حسابتان کسر شده ولی دسترسی فعال نشده، ظرف حداکثر ۷۲ ساعت توسط بانک عودت می‌گردد، یا با پشتیبانی تماس بگیرید.';
      } else if (type === 'pending_verification') {
        title = 'پرداخت در حال بررسی است ⏳';
        link = `/profile/orders/${docId || numId}`;
        message = `تراکنش سفارش شماره #${numId} در حال استعلام بانکی است. به محض تایید نهایی، دسترسی شما فعال می‌شود.`;
      } else if (type === 'rejected') {
        title = 'سفارش شما تایید نشد ❌';
        link = `/profile/orders/${docId || numId}`;
        const reasonText = rejectionReason ? ` (علت: ${rejectionReason})` : '';

        if (firstItemTitle) {
          if (itemsCount > 1) {
            message = `سفارش مربوط به «${firstItemTitle}» و ${itemsCount - 1} مورد دیگر تایید نشد.${reasonText}`;
          } else {
            message = `سفارش مربوط به «${firstItemTitle}» تایید نشد.${reasonText}`;
          }
        } else if (rejectionReason) {
          message = `سفارش شماره #${numId} تایید نشد. علت: ${rejectionReason}`;
        } else {
          message = `فیش واریزی سفارش شماره #${numId} توسط مدیریت تایید نشد.`;
        }
      }

      const eventKey = `${rawId}_${type}`;

      return await this.upsertNotificationForUser({
        userId,
        type,
        title,
        message,
        hint,
        link,
        rawId,
        eventKey,
      });
    } catch (error) {
      console.error('[Notification Service syncOrderNotification Error]:', error?.message || error);
      return null;
    }
  },

  /**
   * بررسی پاسخ استاد یا پشتیبانی به پیام و ثبت خودکار اعلان برای کاربر
   */
  async syncMessageNotification(messageIdentifier, collectionUid = 'api::message.message') {
    try {
      const msg = await findRecordWithUser(strapi, collectionUid, messageIdentifier);
      if (!msg) return null;

      let userId = msg.user?.id || null;

      // اگر در contact-message فیلد user خالی بود ولی شماره موبایل یا ایمیل با کاربری تطابق داشت
      if (!userId && msg.contactInfo) {
        const cleanContact = String(msg.contactInfo).trim();
        if (cleanContact) {
          const matchedUser = await strapi.db.query('plugin::users-permissions.user').findOne({
            where: {
              $or: [{ phoneNumber: cleanContact }, { email: cleanContact }],
            },
            select: ['id'],
          });
          if (matchedUser?.id) {
            userId = matchedUser.id;
          }
        }
      }

      if (!userId) return null;

      const docId = msg.documentId;
      const numId = msg.id;
      const rawId = String(docId || numId);

      const replies = Array.isArray(msg.replies) ? msg.replies : [];
      const isStaffReply = (r) =>
        Boolean(
          r &&
            (r.isAdmin ||
              r.sender === 'instructor' ||
              r.sender === 'admin' ||
              r.sender === 'support')
        );

      const staffReplies = replies.filter(isStaffReply);
      const latestReply = replies.length > 0 ? replies[replies.length - 1] : null;
      const isStatusAnswered = msg.status === 'answered';

      // اگر آخرین پیام در رشته گفتگو از طرف خود کاربر است، اعلان پاسخ جدید برای کاربر نساز
      if (latestReply && !isStaffReply(latestReply)) {
        return null;
      }

      if (staffReplies.length === 0 && !isStatusAnswered) {
        return null;
      }

      const latestStaffReply = staffReplies[staffReplies.length - 1];
      const isMentor =
        collectionUid === 'api::message.message' &&
        (latestStaffReply?.sender === 'instructor' ||
          msg.messageType === 'instructor' ||
          msg.type === 'instructor' ||
          Boolean(msg.metaData));

      const type = isMentor ? 'mentor_reply' : 'support_reply';
      const replyTimestamp =
        latestStaffReply?.createdAt || msg.updatedAt || msg.createdAt || new Date().toISOString();
      const eventKey = `msg_${rawId}_${type}_${replyTimestamp}`;

      const subject = String(msg.subject || '').trim();
      let title = '';
      let message = '';

      if (isMentor) {
        title = 'پاسخ از طرف استاد 🎓';
        message = subject
          ? `پیام شما با موضوع «${subject}» توسط استاد پاسخ داده شد.`
          : 'پیام شما توسط استاد پاسخ داده شد.';
      } else {
        title = 'پاسخ از طرف پشتیبانی 💬';
        message = subject
          ? `پیام شما با موضوع «${subject}» توسط پشتیبانی پاسخ داده شد.`
          : 'پیام شما توسط پشتیبانی پاسخ داده شد.';
      }

      const link = isMentor
        ? `/profile/messages?open=${rawId}&mentor=true`
        : `/profile/messages?open=${rawId}`;

      return await this.upsertNotificationForUser({
        userId,
        type,
        title,
        message,
        hint: null,
        link,
        rawId,
        eventKey,
      });
    } catch (error) {
      console.error('[Notification Service syncMessageNotification Error]:', error?.message || error);
      return null;
    }
  },
}));

'use strict';

/**
 * visitor-stat controller
 * مدیریت ثبت و گزارش‌گیری ترافیک بازدیدکنندگان و شمارش آنلاین در استراپی ۵
 */

const { createCoreController } = require('@strapi/strapi').factories;

// نگه‌داری نشست‌های فعال در حافظه جهت پاسخ‌دهی O(1) فوق‌العاده سریع به ضربان قلب
const activeSessions = new Map();
const ONLINE_THRESHOLD_MS = 3 * 60 * 1000; // ۳ دقیقه
const CLEANUP_THRESHOLD_MS = 10 * 60 * 1000; // ۱۰ دقیقه

/**
 * پاکسازی نشست‌های منقضی‌شده و بازگرداندن تعداد افراد آنلاین
 */
function getOnlineUsersCount() {
  const now = Date.now();
  let onlineCount = 0;

  for (const [id, session] of activeSessions.entries()) {
    const diff = now - session.lastSeen;
    if (diff <= ONLINE_THRESHOLD_MS) {
      onlineCount++;
    } else if (diff > CLEANUP_THRESHOLD_MS) {
      activeSessions.delete(id);
    }
  }

  return Math.max(1, onlineCount); // حداقل ۱ کاربر (همین بازدید جاری/ادمین)
}

module.exports = createCoreController('api::visitor-stat.visitor-stat', ({ strapi }) => ({

  /**
   * POST /api/visitor-stat/track
   * ثبت ضربان قلب کلاینت و در صورت تغییر صفحه، ثبت رکورد بازدید
   */
  async track(ctx) {
    try {
      const body = ctx.request.body || {};
      const visitorId = (body.visitorId || '').trim();
      const path = (body.path || '').trim();
      const device = (body.device || 'desktop').toLowerCase();
      const type = body.type || 'pageview'; // 'pageview' یا 'heartbeat'

      if (!visitorId) {
        return ctx.badRequest('visitorId is required');
      }

      // استخراج IP کلاینت از هدرهای پراکسی
      const clientIp =
        ctx.request.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        ctx.request.ip ||
        '';

      const userAgent = (ctx.request.headers['user-agent'] || '').slice(0, 500);

      // ۱. به‌روزرسانی نشست فعال در حافظه
      activeSessions.set(visitorId, {
        lastSeen: Date.now(),
        path: path || '/',
        device,
        ip: clientIp,
      });

      // ۲. در صورتی که ضربان قلب محض نباشد و صفحه مربوط به ادمین نباشد، لاگ بازدید را ثبت کن
      if (type !== 'heartbeat' && path && !path.startsWith('/admin')) {
        try {
          if (strapi.documents) {
            await strapi.documents('api::visitor-stat.visitor-stat').create({
              data: {
                visitorId,
                path: path.slice(0, 255),
                device,
                ip: clientIp,
                userAgent,
              },
            });
          }
        } catch (dbErr) {
          strapi.log.warn('[visitor-stat] DB log create error: ' + dbErr.message);
        }
      }

      return ctx.send({
        success: true,
        onlineCount: getOnlineUsersCount(),
      });
    } catch (err) {
      strapi.log.error('[visitor-stat] track handler error: ' + err.message);
      return ctx.send({ success: false, error: err.message }, 500);
    }
  },

  /**
   * GET /api/visitor-stat/stats
   * دریافت آمارهای روزانه، هفتگی، ماهانه، سالانه و نمودار برای داشبورد پنل ادمین
   */
  async stats(ctx) {
    try {
      const knex = strapi.db.connection;
      const onlineUsers = getOnlineUsersCount();

      const now = new Date();

      // ابتدای روز جاری به وقت تهران (+03:30)
      const tehranOffsetMs = 3.5 * 60 * 60 * 1000;
      const tehranNow = new Date(now.getTime() + tehranOffsetMs);
      const startOfDayTehran = new Date(
        Date.UTC(
          tehranNow.getUTCFullYear(),
          tehranNow.getUTCMonth(),
          tehranNow.getUTCDate()
        ) - tehranOffsetMs
      );

      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

      // بررسی وجود جدول visitor_stats
      const hasTable = await knex.schema.hasTable('visitor_stats');
      if (!hasTable) {
        return ctx.send({
          onlineUsers,
          daily: { pageViews: 0, uniqueVisitors: 0 },
          weekly: { pageViews: 0, uniqueVisitors: 0 },
          monthly: { pageViews: 0, uniqueVisitors: 0 },
          yearly: { pageViews: 0, uniqueVisitors: 0 },
          total: { pageViews: 0, uniqueVisitors: 0 },
          chartData: [],
          deviceStats: { mobile: 0, desktop: 0, tablet: 0 },
          topPages: [],
        });
      }

      // تابع کمکی برای دریافت تعداد کل و بازدیدکنندگان یکتا در یک بازه زمانی
      async function getMetrics(sinceDate) {
        let query = knex('visitor_stats');
        if (sinceDate) {
          query = query.where('created_at', '>=', sinceDate);
        }

        const res = await query
          .select(
            knex.raw('COUNT(*) as total_views'),
            knex.raw('COUNT(DISTINCT visitor_id) as unique_visitors')
          )
          .first();

        return {
          pageViews: parseInt(res?.total_views || 0, 10),
          uniqueVisitors: parseInt(res?.unique_visitors || 0, 10),
        };
      }

      // اجرای موازی کوئری‌ها
      const [daily, weekly, monthly, yearly, total] = await Promise.all([
        getMetrics(startOfDayTehran),
        getMetrics(sevenDaysAgo),
        getMetrics(thirtyDaysAgo),
        getMetrics(oneYearAgo),
        getMetrics(null),
      ]);

      // دریافت داده‌های روند ۷ روز اخیر برای نمودار تعاملی
      const rawChartRows = await knex('visitor_stats')
        .where('created_at', '>=', sevenDaysAgo)
        .select(
          knex.raw('DATE(created_at) as visit_date'),
          knex.raw('COUNT(*) as views'),
          knex.raw('COUNT(DISTINCT visitor_id) as uniques')
        )
        .groupBy(knex.raw('DATE(created_at)'))
        .orderBy('visit_date', 'asc');

      const chartMap = new Map();
      (rawChartRows || []).forEach((r) => {
        const dStr = new Date(r.visit_date).toISOString().split('T')[0];
        chartMap.set(dStr, {
          pageViews: parseInt(r.views || 0, 10),
          uniqueVisitors: parseInt(r.uniques || 0, 10),
        });
      });

      // ساخت ۷ روز پشت سر هم تا هیچ روزی خالی نباشد
      const chartData = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const isoDate = d.toISOString().split('T')[0];

        // فرمت شمسی کوتاه
        const shamsiLabel = new Intl.DateTimeFormat('fa-IR', {
          month: 'numeric',
          day: 'numeric',
        }).format(d);

        const weekdayLabel = new Intl.DateTimeFormat('fa-IR', {
          weekday: 'short',
        }).format(d);

        const entry = chartMap.get(isoDate) || { pageViews: 0, uniqueVisitors: 0 };

        chartData.push({
          date: isoDate,
          label: shamsiLabel,
          weekday: weekdayLabel,
          pageViews: entry.pageViews,
          uniqueVisitors: entry.uniqueVisitors,
        });
      }

      // سهم نوع دستگاه‌ها
      const deviceRows = await knex('visitor_stats')
        .where('created_at', '>=', thirtyDaysAgo)
        .select('device', knex.raw('COUNT(*) as count'))
        .groupBy('device');

      const deviceStats = { mobile: 0, desktop: 0, tablet: 0 };
      (deviceRows || []).forEach((row) => {
        const dev = (row.device || '').toLowerCase();
        const cnt = parseInt(row.count || 0, 10);
        if (dev.includes('mobile')) deviceStats.mobile += cnt;
        else if (dev.includes('tablet')) deviceStats.tablet += cnt;
        else deviceStats.desktop += cnt;
      });

      // صفحات پربازدید ۳۰ روز اخیر
      const topPagesRows = await knex('visitor_stats')
        .where('created_at', '>=', thirtyDaysAgo)
        .whereNotNull('path')
        .whereNot('path', '')
        .select('path', knex.raw('COUNT(*) as count'))
        .groupBy('path')
        .orderBy('count', 'desc')
        .limit(6);

      const topPages = (topPagesRows || []).map((row) => ({
        path: row.path,
        count: parseInt(row.count || 0, 10),
      }));

      return ctx.send({
        onlineUsers,
        daily,
        weekly,
        monthly,
        yearly,
        total,
        chartData,
        deviceStats,
        topPages,
      });
    } catch (err) {
      strapi.log.error('[visitor-stat] stats handler error: ' + err.message);
      return ctx.send({ error: err.message }, 500);
    }
  },
}));

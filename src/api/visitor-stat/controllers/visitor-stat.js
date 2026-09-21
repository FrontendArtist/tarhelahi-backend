'use strict';

/**
 * visitor-stat controller
 * سیستم فوق‌سبک و بهینه برای شمارش کاربران آنلاین و ورودی‌های یکتای روزانه سایت
 * بدون ذخیره رکوردهای تکراری در دیتابیس (فقط ۱ سطر برای هر روز)
 */

const { createCoreController } = require('@strapi/strapi').factories;

// ۱. مدیریت افراد آنلاین در رم (بدون هیچ‌گونه ذخیره در دیتابیس)
const activeSessions = new Map();
const ONLINE_THRESHOLD_MS = 3 * 60 * 1000; // ۳ دقیقه
const CLEANUP_THRESHOLD_MS = 10 * 60 * 1000; // ۱۰ دقیقه

// ۲. جلوگیری از شمارش مجدد یک فرد در طول همان روز در حافظه رم
let currentActiveDay = '';
const todayVisitorsSet = new Set();

/**
 * محاسبه تاریخ امروز به وقت تهران (YYYY-MM-DD)
 */
function getTehranDateString(d = new Date()) {
  const tehranOffsetMs = 3.5 * 60 * 60 * 1000;
  const tehranDate = new Date(d.getTime() + tehranOffsetMs);
  return tehranDate.toISOString().split('T')[0];
}

/**
 * بازنشانی لیست کاربران امروز در صورت تغییر روز
 */
function checkAndResetDailySet() {
  const today = getTehranDateString();
  if (currentActiveDay !== today) {
    currentActiveDay = today;
    todayVisitorsSet.clear();
  }
  return today;
}

/**
 * شمارش آنلاین‌ها و پاکسازی نشست‌های قدیمی از رم
 */
function getOnlineUsersCount() {
  const now = Date.now();
  let onlineCount = 0;

  for (const [id, lastSeen] of activeSessions.entries()) {
    const diff = now - lastSeen;
    if (diff <= ONLINE_THRESHOLD_MS) {
      onlineCount++;
    } else if (diff > CLEANUP_THRESHOLD_MS) {
      activeSessions.delete(id);
    }
  }

  return Math.max(1, onlineCount);
}

module.exports = createCoreController('api::visitor-stat.visitor-stat', ({ strapi }) => ({

  /**
   * POST /api/visitor-stat/track
   * ثبت ورود کاربر جدید در روز یا دریافت ضربان قلب آنلاین
   */
  async track(ctx) {
    try {
      const body = ctx.request.body || {};
      const visitorId = (body.visitorId || '').trim();
      const type = body.type || 'heartbeat'; // 'enter' یا 'heartbeat'

      if (!visitorId) {
        return ctx.badRequest('visitorId is required');
      }

      // همیشه زمان آخرین فعالیت در رم به‌روزرسانی می‌شود (برای آنلاین‌ها)
      activeSessions.set(visitorId, Date.now());

      const todayDate = checkAndResetDailySet();

      // اگر رویداد ورود به سایت است (اولین بار در روز)
      if (type === 'enter') {
        // اگر این کاربر امروز قبلاً در سرور شمرده شده، هیچ کاری نکن! (صفر عملیات دیتابیس)
        if (todayVisitorsSet.has(visitorId)) {
          return ctx.send({ success: true, onlineCount: getOnlineUsersCount(), alreadyCounted: true });
        }

        // علامت‌گذاری در حافظه رم سرور
        todayVisitorsSet.add(visitorId);

        // افزایش شمارنده در دیتابیس (فقط ۱ سطر برای هر روز)
        const knex = strapi.db.connection;
        const hasTable = await knex.schema.hasTable('daily_visitor_stats');
        
        if (hasTable) {
          const row = await knex('daily_visitor_stats').where({ date: todayDate }).first();
          if (row) {
            await knex('daily_visitor_stats').where({ id: row.id }).increment('count', 1);
          } else {
            // ایجاد سطر برای روز جدید
            await knex('daily_visitor_stats').insert({
              date: todayDate,
              count: 1,
              created_at: new Date(),
              updated_at: new Date(),
              document_id: 'dvs_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
            });
          }
        }
      }

      return ctx.send({
        success: true,
        onlineCount: getOnlineUsersCount(),
      });
    } catch (err) {
      strapi.log.error('[visitor-stat track error]: ' + err.message);
      return ctx.send({ success: false, error: err.message }, 500);
    }
  },

  /**
   * GET /api/visitor-stat/stats
   * دریافت آمارهای روزانه، هفتگی، ماهانه، سالانه و نمودار برای داشبورد ادمین
   */
  async stats(ctx) {
    try {
      const knex = strapi.db.connection;
      const onlineUsers = getOnlineUsersCount();
      const todayDate = checkAndResetDailySet();

      const hasTable = await knex.schema.hasTable('daily_visitor_stats');
      if (!hasTable) {
        return ctx.send({
          onlineUsers,
          daily: 0,
          weekly: 0,
          monthly: 0,
          yearly: 0,
          total: 0,
          chartData: [],
        });
      }

      const now = new Date();
      const getPastDateStr = (daysAgo) => {
        const d = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
        return getTehranDateString(d);
      };

      const date7DaysAgo = getPastDateStr(7);
      const date30DaysAgo = getPastDateStr(30);
      const date365DaysAgo = getPastDateStr(365);

      // اجرای بهینه کوئری‌ها بر روی جدول تک‌سطری روزانه
      const [todayRow, weeklySum, monthlySum, yearlySum, totalSum, recentDays] = await Promise.all([
        knex('daily_visitor_stats').where({ date: todayDate }).first(),
        knex('daily_visitor_stats').where('date', '>=', date7DaysAgo).sum('count as total').first(),
        knex('daily_visitor_stats').where('date', '>=', date30DaysAgo).sum('count as total').first(),
        knex('daily_visitor_stats').where('date', '>=', date365DaysAgo).sum('count as total').first(),
        knex('daily_visitor_stats').sum('count as total').first(),
        knex('daily_visitor_stats').where('date', '>=', date7DaysAgo).select('date', 'count').orderBy('date', 'asc'),
      ]);

      const daily = parseInt(todayRow?.count || 0, 10);
      const weekly = parseInt(weeklySum?.total || 0, 10);
      const monthly = parseInt(monthlySum?.total || 0, 10);
      const yearly = parseInt(yearlySum?.total || 0, 10);
      const total = parseInt(totalSum?.total || 0, 10);

      // ساخت نقشه داده‌های ۷ روز اخیر برای نمودار
      const chartMap = new Map();
      (recentDays || []).forEach((r) => {
        chartMap.set(r.date, parseInt(r.count || 0, 10));
      });

      const chartData = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const isoDate = getTehranDateString(d);

        const shamsiLabel = new Intl.DateTimeFormat('fa-IR', {
          month: 'numeric',
          day: 'numeric',
        }).format(d);

        const weekdayLabel = new Intl.DateTimeFormat('fa-IR', {
          weekday: 'short',
        }).format(d);

        chartData.push({
          date: isoDate,
          label: shamsiLabel,
          weekday: weekdayLabel,
          count: chartMap.get(isoDate) || 0,
        });
      }

      return ctx.send({
        onlineUsers,
        daily,
        weekly,
        monthly,
        yearly,
        total,
        chartData,
      });
    } catch (err) {
      strapi.log.error('[visitor-stat stats error]: ' + err.message);
      return ctx.send({ error: err.message }, 500);
    }
  },
}));

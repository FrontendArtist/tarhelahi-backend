'use strict';

/**
 * Backfill Script: Connect historical order items and user enrollments to persistent Chapter UUIDs (integrationId).
 * 
 * Usage:
 *   node scripts/backfill-chapter-uuids.js --check
 *   node scripts/backfill-chapter-uuids.js --dry-run
 *   node scripts/backfill-chapter-uuids.js --apply
 */

const fs = require('fs');
const path = require('path');
const knex = require('knex');

// تابع نرمال‌سازی متن دقیقاً مطابق با نسخه فرانت‌اند
function normalizeText(text) {
  if (!text) return '';
  return String(text)
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractChapterTitleFromItem(itemTitle, courseTitle) {
  if (!itemTitle) return '';
  let str = String(itemTitle).trim();
  if (courseTitle) {
    const normCourse = normalizeText(courseTitle);
    const normItem = normalizeText(str);
    if (normItem.startsWith(normCourse)) {
      str = str.slice(courseTitle.length).replace(/^[\s\-–—]+/, '').trim();
      return str;
    }
  }
  const parts = str.split(/\s*[-–—]\s*/);
  if (parts.length > 1) {
    return parts[parts.length - 1].trim();
  }
  return str;
}

async function main() {
  const mode = process.argv.find((arg) => ['--check', '--dry-run', '--apply'].includes(arg));
  if (!mode) {
    console.error('لطفاً یکی از حالت‌های --check یا --dry-run یا --apply را مشخص کنید.');
    process.exit(1);
  }

  // لود تنظیمات دیتابیس از فایل .env در صورت وجود
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

  const client = process.env.DATABASE_CLIENT || 'postgres';
  const connection = process.env.DATABASE_URL || {
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: process.env.DATABASE_PORT || 5432,
    database: process.env.DATABASE_NAME || 'strapi',
    user: process.env.DATABASE_USERNAME || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'postgres',
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  };

  const db = knex({ client, connection });

  try {
    console.log(`[Backfill] 🚀 شروع عملیات در حالت ${mode}...`);

    // بررسی وجود جداول مورد نیاز
    const hasOrderItems = await db.schema.hasTable('components_order_course_order_items');
    const hasChapters = await db.schema.hasTable('components_course_parts_chapters');
    const hasCourses = await db.schema.hasTable('courses');

    if (!hasOrderItems || !hasChapters || !hasCourses) {
      console.error('[Backfill] ❌ جداول مربوط به سفارش‌ها یا دوره‌ها در دیتابیس یافت نشدند.');
      process.exit(1);
    }

    // بررسی ستون‌های جدید در components_order_course_order_items
    const hasColUuid = await db.schema.hasColumn('components_order_course_order_items', 'chapter_integration_id');
    const hasColDocId = await db.schema.hasColumn('components_order_course_order_items', 'course_document_id');

    if (!hasColUuid) {
      console.log('[Backfill] ℹ️ ایجاد ستون chapter_integration_id در جدول اقلام سفارش...');
      if (mode === '--apply') {
        await db.schema.alterTable('components_order_course_order_items', (t) => {
          t.string('chapter_integration_id', 36).nullable().index();
        });
      }
    }

    if (!hasColDocId) {
      console.log('[Backfill] ℹ️ ایجاد ستون course_document_id در جدول اقلام سفارش...');
      if (mode === '--apply') {
        await db.schema.alterTable('components_order_course_order_items', (t) => {
          t.string('course_document_id').nullable().index();
        });
      }
    }

    // ۱. مرحله Check: بررسی تطابق تعداد سرفصل‌ها بین draft و published
    const courses = await db('courses')
      .select('id', 'document_id', 'title', 'slug', 'published_at');

    const courseGroups = new Map();
    for (const c of courses) {
      if (!courseGroups.has(c.document_id)) {
        courseGroups.set(c.document_id, { draft: null, published: null });
      }
      if (c.published_at) {
        courseGroups.get(c.document_id).published = c;
      } else {
        courseGroups.get(c.document_id).draft = c;
      }
    }

    console.log(`[Backfill] 🔍 تعداد دوره‌های مجزا: ${courseGroups.size}`);

    // دریافت تمام کامپوننت‌های فصل مرتبط با هر دوره از courses_cmps
    const chapterLinks = await db('courses_cmps as link')
      .join('components_course_parts_chapters as chapter', 'chapter.id', 'link.cmp_id')
      .where({ 'link.field': 'chapters', 'link.component_type': 'course-parts.chapter' })
      .select(
        'link.entity_id as courseId',
        'link.order as linkOrder',
        'chapter.id as chapterId',
        'chapter.title as chapterTitle',
        'chapter.integration_id as integrationId'
      )
      .orderBy('link.order', 'asc');

    const courseChaptersMap = new Map(); // courseId -> chapters[]
    for (const link of chapterLinks) {
      if (!courseChaptersMap.has(link.courseId)) {
        courseChaptersMap.set(link.courseId, []);
      }
      courseChaptersMap.get(link.courseId).push(link);
    }

    // اعتبارسنجی تراز بودن draft و published
    let discrepancies = 0;
    for (const [docId, pair] of courseGroups.entries()) {
      if (pair.draft && pair.published) {
        const draftCount = (courseChaptersMap.get(pair.draft.id) || []).length;
        const pubCount = (courseChaptersMap.get(pair.published.id) || []).length;
        if (draftCount !== pubCount) {
          console.warn(`[Backfill] ⚠️ عدم تطابق تعداد فصل‌ها در دوره «${pair.published.title}» (DocID: ${docId}): پیش‌نویس=${draftCount}، منتشرشده=${pubCount}`);
          discrepancies++;
        }
      }
    }

    if (discrepancies > 0) {
      console.warn(`[Backfill] ⚠️ ${discrepancies} دوره دارای عدم تطابق تعداد فصل در پیش‌نویس و منتشرشده هستند. توصیه می‌شود قبل از اعمال نهایی، این دوره‌ها در پنل ادمین Publish شوند.`);
    } else {
      console.log('[Backfill] ✅ تمام نسخه‌های پیش‌نویس و منتشرشده از نظر تعداد فصل‌ها کاملاً متقارن هستند.');
    }

    if (mode === '--check') {
      console.log('[Backfill] 🏁 بررسی به پایان رسید.');
      process.exit(0);
    }

    // ۲. پردازش اقلام سفارش فصل
    // فقط اقلامی که فصل هستند و هنوز chapter_integration_id ندارند
    const orderItems = await db('components_order_course_order_items as item')
      .select('item.id', 'item.title', 'item.slug', 'item.course_id', 'item.chapter_id', 'item.chapter_integration_id')
      .whereNotNull('item.chapter_id')
      .orWhere('item.slug', 'like', '%-chapter-%');

    console.log(`[Backfill] 📦 تعداد کل اقلام سفارش مربوط به فصل‌ها: ${orderItems.length}`);

    // ایجاد ایندکس سریع از فصل‌های موجود
    // chapterId -> integrationId
    const allChapters = await db('components_course_parts_chapters').select('id', 'title', 'integration_id');
    const chapterIdToIntegrationId = new Map();
    for (const ch of allChapters) {
      if (ch.integration_id) {
        chapterIdToIntegrationId.set(Number(ch.id), ch.integration_id);
      }
    }

    const updates = [];
    const auditRows = [];

    let exactMatches = 0;
    let titleMatches = 0;
    let numberMatches = 0;
    let unmapped = 0;

    for (const item of orderItems) {
      if (item.chapter_integration_id) {
        continue; // از قبل دارد
      }

      let matchedIntegrationId = null;
      let matchedDocId = null;
      let confidence = 'none';

      // روش ۱: chapter_id هنوز در جدول فصل‌ها معتبر است
      if (item.chapter_id && chapterIdToIntegrationId.has(Number(item.chapter_id))) {
        matchedIntegrationId = chapterIdToIntegrationId.get(Number(item.chapter_id));
        confidence = 'exact';
        exactMatches++;
      }

      // روش ۲: اگر با chapter_id پیدا نشد، دوره را پیدا کرده و فصل را تطبیق عنوان دهیم
      if (!matchedIntegrationId) {
        // پیدا کردن دوره
        let matchedCourse = null;
        if (item.course_id) {
          matchedCourse = courses.find((c) => c.id === Number(item.course_id));
        }
        if (!matchedCourse && item.slug) {
          const courseSlug = item.slug.split('-chapter-')[0];
          matchedCourse = courses.find((c) => c.slug === courseSlug);
        }

        if (matchedCourse) {
          matchedDocId = matchedCourse.document_id;
          const pair = courseGroups.get(matchedDocId);
          const publishedCourse = pair?.published || pair?.draft || matchedCourse;
          const chaptersOfCourse = courseChaptersMap.get(publishedCourse.id) || [];

          const extractedTitle = normalizeText(extractChapterTitleFromItem(item.title, matchedCourse.title));
          const itemChapterNumMatch = /(?:فصل|chapter)\s*([0-9]+)/i.exec(extractedTitle || normalizeText(item.title));
          const itemChapterNum = itemChapterNumMatch ? itemChapterNumMatch[1] : null;

          for (const ch of chaptersOfCourse) {
            const chTitleNorm = normalizeText(ch.chapterTitle);

            // تطابق عنوان
            if (extractedTitle && chTitleNorm && extractedTitle === chTitleNorm) {
              matchedIntegrationId = ch.integrationId;
              confidence = 'title';
              titleMatches++;
              break;
            }

            // تطابق شماره فصل
            if (itemChapterNum) {
              const chNumMatch = /(?:فصل|chapter)\s*([0-9]+)/i.exec(chTitleNorm);
              if (chNumMatch && chNumMatch[1] === itemChapterNum) {
                // با شماره مچ شده؛ در صورت لزوم برای بازبینی audit ثبت می‌شود
                matchedIntegrationId = ch.integrationId;
                confidence = 'number';
                numberMatches++;
                break;
              }
            }
          }
        }
      }

      if (matchedIntegrationId && (confidence === 'exact' || confidence === 'title')) {
        updates.push({
          id: item.id,
          chapter_integration_id: matchedIntegrationId,
          course_document_id: matchedDocId,
          confidence,
        });
      } else {
        unmapped++;
        auditRows.push({
          itemId: item.id,
          title: item.title,
          slug: item.slug,
          courseId: item.course_id,
          chapterId: item.chapter_id,
          confidence,
          suggestedIntegrationId: matchedIntegrationId || '',
        });
      }
    }

    console.log(`[Backfill] 📊 نتایج تطبیق:
    - قطعی با شناسه موجود (exact): ${exactMatches}
    - تطابق با عنوان فصل (title): ${titleMatches}
    - تطابق فقط با شماره فصل (number - نیازمند بررسی): ${numberMatches}
    - بدون تطابق (unmapped): ${unmapped}`);

    if (auditRows.length > 0) {
      const csvContent = [
        'itemId,title,slug,courseId,chapterId,confidence,suggestedIntegrationId',
        ...auditRows.map((r) => `${r.itemId},"${(r.title || '').replace(/"/g, '""')}","${r.slug || ''}",${r.courseId || ''},${r.chapterId || ''},${r.confidence},${r.suggestedIntegrationId}`),
      ].join('\n');
      const csvPath = path.resolve(__dirname, '../backfill-review.csv');
      fs.writeFileSync(csvPath, csvContent, 'utf8');
      console.log(`[Backfill] ⚠️ موارد نیازمند بازبینی دستی در فایل زیر ذخیره شد: ${csvPath}`);
    }

    // ۳. مرحله Apply
    if (mode === '--apply') {
      console.log(`[Backfill] 💾 در حال اعمال ${updates.length} به‌روزرسانی روی جدول اقلام سفارش درون تراکنش...`);
      await db.transaction(async (trx) => {
        for (const u of updates) {
          const updatePayload = { chapter_integration_id: u.chapter_integration_id };
          if (u.course_document_id) {
            updatePayload.course_document_id = u.course_document_id;
          }
          await trx('components_order_course_order_items')
            .where({ id: u.id })
            .update(updatePayload);
        }

        // به‌روزرسانی enrolledChapterIntegrationIds برای کاربران بر اساس خریدهای پرداخت‌شده
        console.log('[Backfill] 👤 در حال به‌روزرسانی لیست دسترسی کاربران (enrolledChapterIntegrationIds)...');
        
        // پیدا کردن سفارش‌های موفق
        const paidOrders = await trx('orders')
          .join('orders_user_lnk as user_link', 'user_link.order_id', 'orders.id')
          .join('orders_components as cmp', 'cmp.entity_id', 'orders.id')
          .join('components_order_course_order_items as item', 'item.id', 'cmp.cmp_id')
          .where('cmp.component_type', 'order.course-order-item')
          .whereNotNull('item.chapter_integration_id')
          .where(function() {
            this.where('orders.order_status', 'paid').orWhere('orders.payment_status', 'paid');
          })
          .select('user_link.user_id as userId', 'item.chapter_integration_id as integrationId');

        const userUuidsMap = new Map();
        for (const row of paidOrders) {
          if (!userUuidsMap.has(row.userId)) {
            userUuidsMap.set(row.userId, new Set());
          }
          userUuidsMap.get(row.userId).add(String(row.integrationId).toLowerCase());
        }

        for (const [userId, uuidSet] of userUuidsMap.entries()) {
          const user = await trx('up_users').where({ id: userId }).select('enrolled_chapter_integration_ids').first();
          let existing = [];
          if (user?.enrolled_chapter_integration_ids) {
            try {
              existing = typeof user.enrolled_chapter_integration_ids === 'string'
                ? JSON.parse(user.enrolled_chapter_integration_ids)
                : user.enrolled_chapter_integration_ids;
            } catch {}
          }
          const merged = [...new Set([...(Array.isArray(existing) ? existing : []), ...Array.from(uuidSet)])];

          await trx('up_users')
            .where({ id: userId })
            .update({
              enrolled_chapter_integration_ids: JSON.stringify(merged),
            });
        }
      });

      console.log('[Backfill] 🎉 عملیات Backfill با موفقیت در دیتابیس اعمال شد.');
    } else {
      console.log('[Backfill] ℹ️ در حالت dry-run هیچ تغییری در دیتابیس ذخیره نشد.');
    }
  } catch (err) {
    console.error('[Backfill] 💥 خطای غیرمنتظره در اجرای اسکریپت:', err);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

main();

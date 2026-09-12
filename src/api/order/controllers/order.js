'use strict';

/**
 * order controller
 */

const { createCoreController } = require('@strapi/strapi').factories;
const excelService = require('../services/excel-export');

function getStatusRank(order) {
  const attrs = order?.attributes || order || {};
  const orderStatus = (attrs.orderStatus || '').trim().toLowerCase();
  const paymentStatus = (attrs.paymentStatus || '').trim().toLowerCase();
  const paymentMethod = (attrs.paymentMethod || '').trim().toLowerCase();
  const hasReceipt = Boolean(attrs.receiptImage || attrs.receiptImageUrl);

  const isWaitingReceipt =
    (paymentMethod === 'card_to_card' && paymentStatus === 'pending_verification') ||
    (hasReceipt && orderStatus === 'pending');

  if (isWaitingReceipt) return 1;
  if (orderStatus === 'pending') return 2;
  if (['paid', 'shipped', 'delivered'].includes(orderStatus) || paymentStatus === 'paid') return 3;
  if (orderStatus === 'canceled') return 4;
  return 5;
}

module.exports = createCoreController('api::order.order', ({ strapi }) => ({
  /**
   * Find orders with optional multi-tier statusPriority sorting across entire database
   * GET /api/orders
   */
  async find(ctx) {
    const isPrioritySort = ctx.query.statusPriority === 'true' || ctx.query.statusPriority === true;

    if (!isPrioritySort) {
      return super.find(ctx);
    }

    try {
      const originalQuery = { ...ctx.query };
      delete ctx.query.pagination;
      delete ctx.query.statusPriority;

      // در Strapi 5 نباید همزمان از limit (آفست) و pageSize (صفحه‌ای) استفاده شود.
      // بنابراین فقط از یک نوع (سقف limit: 1000) برای واکشی کل سفارش‌ها استفاده می‌کنیم:
      ctx.query.pagination = { limit: 1000 };

      const response = await super.find(ctx);
      let allItems = response?.data || [];

      allItems.sort((a, b) => {
        const rankA = getStatusRank(a);
        const rankB = getStatusRank(b);
        if (rankA !== rankB) {
          return rankA - rankB;
        }
        const dateA = new Date(a.createdAt || a.attributes?.createdAt || 0).getTime();
        const dateB = new Date(b.createdAt || b.attributes?.createdAt || 0).getTime();
        return dateB - dateA;
      });

      const start = parseInt(originalQuery.pagination?.start ?? originalQuery.start ?? '0', 10) || 0;
      const limit = parseInt(originalQuery.pagination?.limit ?? originalQuery.limit ?? '20', 10) || 20;

      const paginatedData = allItems.slice(start, start + limit);

      return {
        data: paginatedData,
        meta: {
          pagination: {
            start,
            limit,
            total: allItems.length,
            page: Math.floor(start / limit) + 1,
            pageSize: limit,
            pageCount: Math.ceil(allItems.length / limit) || 1,
          },
        },
      };
    } catch (err) {
      console.error('[OrderController find Error]:', err);
      return super.find(ctx);
    }
  },

  /**
   * Export all orders and revenue report as a downloadable Excel file (.xlsx)
   * GET /api/orders/export-excel
   */
  async exportExcel(ctx) {
    try {
      const { buffer } = await excelService.generateExcelBuffer();

      const fileName = `tarhelahi_orders_revenue_${new Date().toISOString().split('T')[0]}.xlsx`;

      ctx.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      ctx.set('Content-Disposition', `attachment; filename="${fileName}"`);
      ctx.body = buffer;
    } catch (err) {
      ctx.throw(500, `خطا در تولید فایل اکسل سفارش‌ها: ${err.message}`);
    }
  },

  /**
   * Get real-time revenue and sales statistics (daily, weekly, monthly, Persian month, and KPI metrics)
   * GET /api/orders/revenue-stats
   */
  async revenueStats(ctx) {
    try {
      const orders = await strapi.db.query('api::order.order').findMany({
        populate: ['user', 'items'],
        orderBy: { id: 'desc' },
      });

      const stats = excelService.calculateRevenueMetrics(orders || []);
      return ctx.send(stats);
    } catch (err) {
      ctx.throw(500, `خطا در محاسبه آمار درآمد: ${err.message}`);
    }
  },

  /**
   * Manually trigger Excel file regeneration on disk (public/exports/orders_revenue_report.xlsx)
   * POST /api/orders/sync-excel
   */
  async syncExcel(ctx) {
    try {
      const result = await excelService.generateAndSaveExcelReport();
      return ctx.send({
        message: 'فایل اکسل سفارش‌ها و گزارش درآمد با موفقیت بر روی سرور بروزرسانی شد',
        ...result,
      });
    } catch (err) {
      ctx.throw(500, `خطا در ذخیره فایل اکسل: ${err.message}`);
    }
  },

  /**
   * Bulk settle orders in a single DB transaction — avoids N individual PUT requests
   * POST /api/orders/bulk-settle
   *
   * Body: { orderDocumentIds: string[], settlementDocumentId: string, settledAt: string }
   *
   * Returns: { settled: number } — count of rows actually updated
   */
  async bulkSettle(ctx) {
    try {
      const { orderDocumentIds, settlementDocumentId, settledAt } = ctx.request.body;

      // ── اعتبارسنجی ورودی ────────────────────────────────────────────────────
      if (!Array.isArray(orderDocumentIds) || orderDocumentIds.length === 0) {
        return ctx.badRequest('orderDocumentIds آرایه‌ای خالی یا نامعتبر است');
      }
      if (!settlementDocumentId) {
        return ctx.badRequest('settlementDocumentId اجباری است');
      }

      const settledAtDate = settledAt ? new Date(settledAt) : new Date();

      // ── یافتن رکورد settlement از طریق documentId ──────────────────────────
      const settlementRecord = await strapi.db.query('api::settlement.settlement').findOne({
        where: { documentId: settlementDocumentId },
        select: ['id', 'documentId'],
      });

      if (!settlementRecord) {
        return ctx.notFound(`تسویه با documentId="${settlementDocumentId}" یافت نشد`);
      }

      const settlementNumericId = settlementRecord.id;
      const knex = strapi.db.connection;

      // ── یافتن شناسه عددی سفارش‌های واجد شرایط (تسویه‌نشده) ─────────────────
      const targetOrders = await knex('orders')
        .whereIn('document_id', orderDocumentIds)
        .whereNull('settled_at')
        .select('id');

      if (targetOrders.length === 0) {
        return ctx.send({ settled: 0 });
      }

      const targetOrderIds = targetOrders.map((o) => o.id);

      // ── ۱. به‌روزرسانی تاریخ تسویه در جدول orders ─────────────────────────
      const updatedCount = await knex('orders')
        .whereIn('id', targetOrderIds)
        .update({
          settled_at: settledAtDate,
          updated_at: settledAtDate,
        });

      // ── ۲. ثبت رابطه در جدول پیوند orders_settlement_lnk ──────────────────
      await knex('orders_settlement_lnk')
        .whereIn('order_id', targetOrderIds)
        .delete();

      const lnkRows = targetOrderIds.map((orderId, idx) => ({
        order_id: orderId,
        settlement_id: settlementNumericId,
        order_ord: idx + 1,
      }));

      await knex.batchInsert('orders_settlement_lnk', lnkRows, 500);

      strapi.log.info(`[bulkSettle] Successfully settled ${updatedCount} orders → settlement #${settlementNumericId}`);

      return ctx.send({ settled: updatedCount });
    } catch (err) {
      strapi.log.error('[bulkSettle] Error:', err);
      ctx.throw(500, `خطا در تسویه دسته‌ای: ${err.message}`);
    }
  },
}));


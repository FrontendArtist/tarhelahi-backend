'use strict';

/**
 * order controller
 */

const { createCoreController } = require('@strapi/strapi').factories;
const excelService = require('../services/excel-export');

module.exports = createCoreController('api::order.order', ({ strapi }) => ({
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
}));

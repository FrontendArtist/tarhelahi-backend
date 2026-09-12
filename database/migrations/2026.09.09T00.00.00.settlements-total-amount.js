'use strict';

/**
 * Migration: تغییر نوع فیلد total_amount در جدول settlements از decimal(10,2) به bigint
 * دلیل: جلوگیری از خطای numeric field overflow در دیتابیس PostgreSQL به هنگام ثبت مبالغ بالاتر از ۱۰۰ میلیون
 */
module.exports = {
  async up(knex) {
    const hasTable = await knex.schema.hasTable('settlements');
    if (hasTable) {
      const hasColumn = await knex.schema.hasColumn('settlements', 'total_amount');
      if (hasColumn) {
        await knex.raw('ALTER TABLE "settlements" ALTER COLUMN "total_amount" TYPE bigint USING ("total_amount"::bigint);');
      }
    }
  },
  async down(knex) {
    // بازگشت نیازی نیست
  },
};

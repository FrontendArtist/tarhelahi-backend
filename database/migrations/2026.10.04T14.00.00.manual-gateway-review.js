'use strict';

module.exports = {
  async up(knex) {
    const cases = 'gateway_review_cases';
    const history = 'gateway_review_case_histories';
    if (await knex.schema.hasTable(cases)) {
      for (const [column, type] of Object.entries({ revision: 'integer', resolution_operation_id: 'string', resolution_audit: 'jsonb', manual_refund_reference: 'string' })) {
        if (!(await knex.schema.hasColumn(cases, column)))
          await knex.schema.alterTable(cases, table => table[type](column).nullable());
      }
      await knex(cases).whereNull('revision').update({ revision: 1 });
    }
    if (await knex.schema.hasTable(history)) {
      if (!(await knex.schema.hasColumn(history, 'dedup_key')))
        await knex.schema.alterTable(history, table => table.string('dedup_key').unique().nullable());
      if (!(await knex.schema.hasColumn(history, 'sync_status')))
        await knex.schema.alterTable(history, table => table.string('sync_status').nullable());
    }
    // جدول عملیات و قیود schema با همگام‌سازی content-type استرپی ساخته می‌شوند.
  },
};

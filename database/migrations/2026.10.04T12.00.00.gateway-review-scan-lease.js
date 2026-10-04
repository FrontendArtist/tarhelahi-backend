'use strict';

module.exports = {
  async up(knex) {
    const table = 'gateway_payment_attempts';
    if (!(await knex.schema.hasTable(table))) return;
    if (!(await knex.schema.hasColumn(table, 'review_scan_lease_until_utc'))) {
      await knex.schema.alterTable(table, (builder) => builder.dateTime('review_scan_lease_until_utc').nullable());
    }
  },

  async down(knex) {
    const table = 'gateway_payment_attempts';
    if (await knex.schema.hasTable(table) && await knex.schema.hasColumn(table, 'review_scan_lease_until_utc')) {
      await knex.schema.alterTable(table, (builder) => builder.dropColumn('review_scan_lease_until_utc'));
    }
  },
};

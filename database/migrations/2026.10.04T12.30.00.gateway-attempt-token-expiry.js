'use strict';

module.exports = {
  async up(knex) {
    const table = 'gateway_payment_attempts';
    if (!(await knex.schema.hasTable(table))) return;
    if (!(await knex.schema.hasColumn(table, 'token_expires_at_utc')))
      await knex.schema.alterTable(table, (builder) => builder.dateTime('token_expires_at_utc').nullable());
  },

  async down(knex) {
    const table = 'gateway_payment_attempts';
    if (await knex.schema.hasTable(table) && await knex.schema.hasColumn(table, 'token_expires_at_utc'))
      await knex.schema.alterTable(table, (builder) => builder.dropColumn('token_expires_at_utc'));
  },
};

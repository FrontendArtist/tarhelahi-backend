'use strict';

const table = 'gateway_payment_attempts';
const column = 'top_up_request_id';
const indexName = 'gateway_payment_attempts_top_up_request_id_idx';

module.exports = {
  async up(knex) {
    if (!(await knex.schema.hasTable(table)) || !(await knex.schema.hasColumn(table, column))) return;
    try {
      await knex.schema.alterTable(table, (builder) => builder.index([column], indexName));
    } catch (error) {
      if (!/already exists|duplicate key name/i.test(error.message)) throw error;
    }
  },

  async down(knex) {
    if (!(await knex.schema.hasTable(table))) return;
    try {
      await knex.schema.alterTable(table, (builder) => builder.dropIndex([column], indexName));
    } catch (error) {
      if (!/does not exist|check that column\/key exists|no such index/i.test(error.message)) throw error;
    }
  },
};

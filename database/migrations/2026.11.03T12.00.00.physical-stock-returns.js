'use strict';

const RETURNS = 'physical_stock_returns';

module.exports = {
  async up(knex) {
    if (await knex.schema.hasTable(RETURNS)) {
      return;
    }
    await knex.schema.createTable(RETURNS, (table) => {
      table.string('operation_id').notNullable();
      table.string('purchase_id').notNullable();
      table.string('cart_id').notNullable();
      table.string('document_id').notNullable();
      table.integer('quantity').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable();
      table.primary(['operation_id', 'purchase_id']);
      table.index(['cart_id', 'purchase_id']);
    });
    await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT physical_stock_returns_quantity_positive CHECK (quantity > 0)`, [RETURNS]);
  },

  async down(knex) {
    await knex.schema.dropTableIfExists(RETURNS);
  },
};

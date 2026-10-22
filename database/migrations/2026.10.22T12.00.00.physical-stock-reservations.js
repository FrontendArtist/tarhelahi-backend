'use strict';

const INVENTORY = 'physical_product_inventory';
const RESERVATIONS = 'physical_stock_reservations';

module.exports = {
  async up(knex) {
    if (!(await knex.schema.hasTable(INVENTORY))) {
      await knex.schema.createTable(INVENTORY, (table) => {
        table.string('document_id').primary();
        table.integer('available_quantity').notNullable();
      });
    }
    if (!(await knex.schema.hasTable(RESERVATIONS))) {
      await knex.schema.createTable(RESERVATIONS, (table) => {
        table.string('reservation_id').primary();
        table.text('fingerprint').notNullable();
        table.jsonb('items').notNullable();
        table.string('state').notNullable();
        table.timestamp('created_at', { useTz: true }).notNullable();
        table.timestamp('expires_at', { useTz: true }).notNullable();
      });
    }
    if (await knex.schema.hasTable('products')) {
      const products = await knex('products').select('document_id', 'stock', 'published_at', 'id').orderBy('id');
      const groups = new Map();
      for (const product of products) {
        if (!groups.has(product.document_id) || product.published_at) {
          groups.set(product.document_id, product);
        }
      }
      // تنها INSERT در جدول تازه؛ موجودی دو نسخه جمع نمی‌شود و دادهٔ قبلی بازنویسی نمی‌شود.
      for (const product of groups.values()) {
        if (!Number.isSafeInteger(product.stock) || product.stock < 0) {
          throw new Error('موجودی قبلی کالا معتبر نیست؛ پیش از مهاجرت بررسی شود.');
        }
        await knex(INVENTORY).insert({
          document_id: product.document_id,
          available_quantity: product.stock,
        }).onConflict('document_id').ignore();
      }
      if (!(await knex.schema.hasColumn('products', 'weight'))) {
        await knex.schema.alterTable('products', (table) => table.decimal('weight').nullable());
      }
    }
    for (const [tableName, columns] of [
      ['orders', ['inventory_reservation_id', 'shipping_rule_label', 'address_version']],
    ]) {
      if (!(await knex.schema.hasTable(tableName))) {
        continue;
      }
      for (const column of columns) {
        if (!(await knex.schema.hasColumn(tableName, column))) {
          await knex.schema.alterTable(tableName, (table) => table.string(column).nullable());
        }
      }
      for (const column of ['address_snapshot', 'cart_snapshot']) {
        if (!(await knex.schema.hasColumn(tableName, column))) {
          await knex.schema.alterTable(tableName, (table) => table.jsonb(column).nullable());
        }
      }
      if (!(await knex.schema.hasColumn(tableName, 'shipping_amount_in_noor'))) {
        await knex.schema.alterTable(tableName, (table) => table.decimal('shipping_amount_in_noor').nullable());
      }
    }
    if (await knex.schema.hasTable('byemoney_carts') &&
      !(await knex.schema.hasColumn('byemoney_carts', 'order_document_id'))) {
      await knex.schema.alterTable('byemoney_carts', (table) => table.string('order_document_id').nullable());
    }
  },
};

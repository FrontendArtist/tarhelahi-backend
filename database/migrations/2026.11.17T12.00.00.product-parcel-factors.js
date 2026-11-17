'use strict';

/**
 * SHIP-PARCEL-FACTORS: ابعاد و شکستنی کالا برای استعلام/ساخت مرسولهٔ پستکس.
 * weight از قبل وجود دارد (گرم). length/width/height سانتی‌متر.
 */

module.exports = {
  async up(knex) {
    if (!(await knex.schema.hasTable('products'))) {
      return;
    }

    const columns = [
      ['length', (table) => table.decimal('length').nullable()],
      ['width', (table) => table.decimal('width').nullable()],
      ['height', (table) => table.decimal('height').nullable()],
      ['is_fragile', (table) => table.boolean('is_fragile').nullable().defaultTo(false)],
    ];

    for (const [name, add] of columns) {
      if (!(await knex.schema.hasColumn('products', name))) {
        await knex.schema.alterTable('products', (table) => add(table));
      }
    }
  },
};

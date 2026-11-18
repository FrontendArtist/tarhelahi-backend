'use strict';

/**
 * SHIP-BOX-TYPE: جعبهٔ استاندارد پستکس به‌جای ابعاد آزاد کالا.
 * box_type_id افزودنی و nullable؛ length/width/height حذف می‌شوند؛ بدون حدس جعبه از ابعاد.
 */

module.exports = {
  async up(knex) {
    if (!(await knex.schema.hasTable('products'))) {
      return;
    }

    if (!(await knex.schema.hasColumn('products', 'box_type_id'))) {
      await knex.schema.alterTable('products', (table) => {
        table.string('box_type_id').nullable();
      });
    }

    for (const name of ['length', 'width', 'height']) {
      if (await knex.schema.hasColumn('products', name)) {
        await knex.schema.alterTable('products', (table) => {
          table.dropColumn(name);
        });
      }
    }
  },
};

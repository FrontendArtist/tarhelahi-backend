'use strict';

const crypto = require('crypto');

/**
 * Migration: Add integration_id column and index to components_course_parts_chapters
 * and backfill all existing records with standard RFC 4122 v4 UUIDs.
 */
module.exports = {
  async up(knex) {
    const tableName = 'components_course_parts_chapters';
    const hasTable = await knex.schema.hasTable(tableName);
    if (!hasTable) return;

    const hasColumn = await knex.schema.hasColumn(tableName, 'integration_id');
    if (!hasColumn) {
      await knex.schema.alterTable(tableName, (table) => {
        table.string('integration_id', 36).nullable().index();
      });
    }

    // Backfill rows with missing integration_id
    const rows = await knex(tableName)
      .select('id')
      .whereNull('integration_id')
      .orWhere('integration_id', '');

    for (const row of rows) {
      const uuid = crypto.randomUUID();
      await knex(tableName)
        .where({ id: row.id })
        .update({ integration_id: uuid });
    }
  },

  async down(knex) {
    const tableName = 'components_course_parts_chapters';
    const hasTable = await knex.schema.hasTable(tableName);
    if (!hasTable) return;

    const hasColumn = await knex.schema.hasColumn(tableName, 'integration_id');
    if (hasColumn) {
      await knex.schema.alterTable(tableName, (table) => {
        table.dropColumn('integration_id');
      });
    }
  },
};

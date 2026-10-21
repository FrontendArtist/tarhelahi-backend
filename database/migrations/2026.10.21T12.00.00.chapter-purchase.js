'use strict';

const { randomUUID } = require('node:crypto');
const CHAPTERS = 'components_course_parts_chapters';
const LINKS = 'courses_cmps';
const COURSES = 'courses';
const LOGS = 'byemoney_purchase_logs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function backfill(knex) {
  if (!(await knex.schema.hasTable(CHAPTERS))) {
    return;
  }
  if (!(await knex.schema.hasColumn(CHAPTERS, 'integration_id'))) {
    await knex.schema.alterTable(CHAPTERS, (table) => {
      table.string('integration_id', 36).nullable().index();
    });
  }
  const rows = await knex(`${COURSES} as course`)
    .join(`${LINKS} as link`, 'link.entity_id', 'course.id')
    .join(`${CHAPTERS} as chapter`, 'chapter.id', 'link.cmp_id')
    .where({ 'link.field': 'chapters', 'link.component_type': 'course-parts.chapter' })
    .select(
      'chapter.id',
      'chapter.integration_id',
      'course.document_id',
      'course.published_at',
      'link.order',
    )
    .orderBy('course.document_id')
    .orderBy('link.order')
    .orderBy('course.published_at', 'asc', 'last');
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.document_id, row.order]);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(row);
  }
  const used = new Set();
  for (const versions of groups.values()) {
    // ترتیب فصل در والد معیار تطبیق است؛ شناسهٔ عددی بین دو نسخه تغییر می‌کند.
    const candidate = versions
      .find((row) => UUID.test(row.integration_id || ''))
      ?.integration_id.toLowerCase();
    const integrationId = candidate && !used.has(candidate) ? candidate : randomUUID();
    used.add(integrationId);
    for (const chapter of versions) {
      if (chapter.integration_id !== integrationId) {
        await knex(CHAPTERS).where({ id: chapter.id }).update({ integration_id: integrationId });
      }
    }
  }
  // UNIQUE نادرست است: پیش‌نویس و منتشرشده باید مقدار یکسان داشته باشند.
  // این مهاجرت به enrolledChapters و روابط دسترسی دست نمی‌زند.
}

module.exports = {
  async up(knex) {
    await backfill(knex);
    if (await knex.schema.hasTable(LOGS)) {
      for (const column of ['item_type', 'chapter_external_id', 'parent_external_id']) {
        if (!(await knex.schema.hasColumn(LOGS, column))) {
          await knex.schema.alterTable(LOGS, (table) => {
            table.string(column).nullable();
          });
        }
      }
      await knex(LOGS).whereNull('item_type').update({ item_type: 'course' });
    }
  },
};

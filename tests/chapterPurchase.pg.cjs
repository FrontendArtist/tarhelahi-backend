'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const knexFactory = require('knex');
const migration = require('../database/migrations/2026.10.21T12.00.00.chapter-purchase');

const enabled = process.env.CHAPTER_PURCHASE_PG_TESTS === '1';

test('مهاجرت فصل روی PostgreSQL و اجرای واقعی استرپی', { skip: !enabled }, async (t) => {
  require('dotenv').config({ quiet: true });
  const connection = {
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 5432),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
  };
  const knex = knexFactory({ client: 'pg', connection });
  const schema = `chapter_test_${randomUUID().replaceAll('-', '')}`;
  try {
    await t.test('تطابق ترتیبی دو نسخه، یکتایی میان والدها و اجرای دوبارهٔ بی‌اثر', async () => {
      await knex.schema.createSchema(schema);
      const isolated = knexFactory({ client: 'pg', connection, searchPath: [schema] });
      try {
        await isolated.schema.createTable('courses', (table) => {
          table.integer('id').primary();
          table.string('document_id');
          table.timestamp('published_at');
        });
        await isolated.schema.createTable('courses_cmps', (table) => {
          table.integer('entity_id');
          table.integer('cmp_id');
          table.string('component_type');
          table.string('field');
          table.integer('order');
        });
        await isolated.schema.createTable('components_course_parts_chapters', (table) => {
          table.integer('id').primary();
          table.string('integration_id');
          table.string('title');
        });
        await isolated.schema.createTable('byemoney_purchase_logs', (table) => {
          table.integer('id').primary();
          table.string('course_id');
        });
        await isolated('courses').insert([
          { id: 1, document_id: 'one' },
          { id: 2, document_id: 'one', published_at: new Date() },
          { id: 3, document_id: 'two', published_at: new Date() },
        ]);
        const shared = randomUUID();
        await isolated('components_course_parts_chapters').insert([
          { id: 10, integration_id: null, title: 'اول' },
          { id: 20, integration_id: shared, title: 'اول' },
          { id: 11, integration_id: randomUUID(), title: 'دوم' },
          { id: 21, integration_id: randomUUID(), title: 'دوم' },
          { id: 30, integration_id: shared, title: 'والد دیگر' },
        ]);
        await isolated('courses_cmps').insert(
          [
            { entity_id: 1, cmp_id: 10, order: 1 },
            { entity_id: 2, cmp_id: 20, order: 1 },
            { entity_id: 1, cmp_id: 11, order: 2 },
            { entity_id: 2, cmp_id: 21, order: 2 },
            { entity_id: 3, cmp_id: 30, order: 1 },
          ].map((row) => ({ ...row, field: 'chapters', component_type: 'course-parts.chapter' })),
        );
        await isolated('byemoney_purchase_logs').insert({ id: 1, course_id: 'historical' });
        await isolated.transaction((trx) => migration.up(trx));
        const first = await isolated('components_course_parts_chapters').orderBy('id');
        assert.equal(first[0].integration_id, first[2].integration_id);
        assert.equal(first[1].integration_id, first[3].integration_id);
        assert.equal(new Set(first.map((row) => row.integration_id)).size, 3);
        assert.equal((await isolated('byemoney_purchase_logs').first()).item_type, 'course');
        await isolated.transaction((trx) => migration.up(trx));
        assert.deepEqual(await isolated('components_course_parts_chapters').orderBy('id'), first);
      } finally {
        await isolated.destroy();
      }
    });

    await t.test(
      'چرخهٔ واقعی ایجاد، انتشار، ویرایش، کپی و تحویل اتمیک بدون اعطای دوره',
      async () => {
        const { createStrapi } = require('@strapi/strapi');
        const app = await createStrapi({ distDir: process.cwd() }).load();
        const rollback = new Error('chapter-test-rollback');
        try {
          await assert.rejects(
            app.db.transaction(async () => {
              const courses = app.documents('api::course.course');
              const suffix = randomUUID();
              const course = await courses.create({
                data: {
                  title: 'آزمون فصل',
                  slug: `chapter-test-${suffix}`,
                  price: 1000,
                  isChaptered: true,
                  chapters: [
                    { title: 'فصل اول', price: 105 },
                    { title: 'فصل دوم', price: 205 },
                  ],
                },
                populate: ['chapters'],
              });
              assert.ok(
                course.chapters.every((chapter) => /^[0-9a-f-]{36}$/.test(chapter.integrationId)),
              );
              const firstId = course.chapters[0].integrationId;
              await courses.publish({ documentId: course.documentId });
              const published = await courses.findOne({
                documentId: course.documentId,
                status: 'published',
                populate: ['chapters'],
              });
              assert.equal(published.chapters[0].integrationId, firstId);
              assert.notEqual(published.chapters[0].id, course.chapters[0].id);
              const edited = await courses.update({
                documentId: course.documentId,
                data: {
                  chapters: course.chapters.map((chapter) => ({
                    id: chapter.id,
                    title: chapter.title,
                    price: chapter.price,
                  })),
                },
                populate: ['chapters'],
              });
              assert.equal(edited.chapters[0].integrationId, firstId);
              const clone = await courses.clone({
                documentId: course.documentId,
                data: { slug: `clone-${suffix}` },
                populate: ['chapters'],
              });
              assert.notEqual(clone.entries[0].chapters[0].integrationId, firstId);
              await assert.rejects(
                courses.create({
                  data: {
                    title: 'نامعتبر',
                    slug: `invalid-${suffix}`,
                    price: 100,
                    chapters: [{ title: 'نامعتبر', integrationId: 'bad' }],
                  },
                }),
              );
              await assert.rejects(
                courses.create({
                  data: {
                    title: 'تکراری',
                    slug: `duplicate-${suffix}`,
                    price: 100,
                    chapters: [{ title: 'تکراری', integrationId: firstId }],
                  },
                }),
              );
              await assert.rejects(
                courses.update({
                  documentId: course.documentId,
                  data: {
                    chapters: [
                      {
                        id: edited.chapters[0].id,
                        title: 'تغییر هویت',
                        integrationId: randomUUID(),
                      },
                    ],
                  },
                }),
              );

              const user = await app.db.query('plugin::users-permissions.user').create({
                data: {
                  username: `chapter-test-${suffix}`,
                  email: `${suffix}@example.test`,
                  confirmed: true,
                  blocked: false,
                  enrolledChapters: [],
                },
              });
              const service = require('../src/services/byeMoneyCartService');
              const request = {
                cartId: randomUUID(),
                buyerExternalUserId: user.documentId,
                externalCourseIds: [firstId],
              };
              await service.prepare(app, request);
              await service.transition(app, request, 'check');
              const commit = { ...request, purchaseIds: [randomUUID()] };
              await service.transition(app, commit, 'commit');
              await service.transition(app, commit, 'commit');
              const actual = await app.db.query('plugin::users-permissions.user').findOne({
                where: { id: user.id },
                populate: ['courses'],
              });
              assert.deepEqual(actual.enrolledChapters, [published.chapters[0].id]);
              assert.equal(actual.courses.length, 0);
              await assert.rejects(
                service.prepare(app, { ...request, cartId: randomUUID() }),
                (error) => error.code === 'CART_UNAVAILABLE',
              );
              throw rollback;
            }),
            (error) => error === rollback,
          );
        } finally {
          await app.destroy();
        }
      },
    );
  } finally {
    await knex.schema.dropSchemaIfExists(schema, true);
    await knex.destroy();
  }
});

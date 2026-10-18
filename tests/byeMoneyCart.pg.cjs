'use strict';
// این مجموعه با node --test اجرا می‌شود؛ مجموعه‌های Jest مستقل‌اند.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');
const knexFactory = require('knex');
const couponFactory = require('../src/api/coupon/services/coupon');
const service = require('../src/services/byeMoneyCartService');

test('رزرو و تحویل سبد روی PostgreSQL مستقل', { skip: process.env.BYEMONEY_CART_PG_TESTS !== '1' }, async t => {
  const local = require('dotenv').config({ quiet: true }).parsed || {};
  const config = { ...local, ...process.env };
  const knex = knexFactory({ client: 'pg', connection: { host: config.DATABASE_HOST || '127.0.0.1',
    port: Number(config.DATABASE_PORT || 5432), database: config.DATABASE_NAME || 'tarhelahi_db',
    user: config.DATABASE_USERNAME || 'postgres', password: config.DATABASE_PASSWORD || '123456' }, pool: { min: 0, max: 8 } });
  const schema = 'cart_test_' + randomUUID().replaceAll('-', '');
  const storage = new AsyncLocalStorage();
  const table = name => (storage.getStore() || knex)(`${schema}.${name}`);
  const names = { 'api::byemoney-cart.byemoney-cart': 'carts', 'api::course.course': 'courses',
    'plugin::users-permissions.user': 'users', 'api::byemoney-purchase-log.byemoney-purchase-log': 'logs' };
  const match = (item, where) => Object.entries(where).every(([key, value]) =>
    value && typeof value === 'object' && '$notNull' in value ? item[key] != null : item[key] === value);
  let couponService;
  const strapi = {
    contentType: () => ({}),
    documents: uid => ({ findMany: async () => (await table('coupons').select()).map(row => ({
      id: row.id, documentId: 'coupon', code: row.code, usedCount: row.used_count, maxUsage: 1, isActive: true,
      discountType: 'percentage', discountValue: 10, appliesToAllCourses: true,
    })), findOne: async ({ documentId }) => {
      const rows = await table(names[uid]).select();
      return rows.map(row => ({ ...row.payload, id: row.id })).find(row => row.documentId === documentId && row.publishedAt);
    } }),
    service: () => couponService,
    db: {
      metadata: { get: () => ({ tableName: `${schema}.coupons`, attributes: { code: { columnName: 'code' } } }) },
      transaction: fn => storage.getStore() ? fn({ trx: storage.getStore() }) : knex.transaction(trx => storage.run(trx, () => fn({ trx }))),
      query: uid => uid === 'api::coupon.coupon' ? {
        findMany: async ({ where }) => (await table('coupons').whereRaw('LOWER(code) = LOWER(?)', [where.code.$eqi])).map(row => ({
          id: row.id, code: row.code, usedCount: row.used_count, maxUsage: 1, isActive: true,
        })),
        update: ({ where, data }) => table('coupons').where(where).update({ used_count: data.usedCount }),
      } : {
        findOne: async ({ where, populate }) => {
          const result = (await table(names[uid]).select()).map(row => ({ ...row.payload, id: row.id })).find(row => match(row, where));
          if (result && uid === 'plugin::users-permissions.user' && populate?.includes('courses')) {
            const courses = (await table('courses').select()).map(row => ({ ...row.payload, id: row.id }));
            result.courses = (result.courses || []).map(course => typeof course === 'object' ? course : courses.find(row => row.id === course));
          }
          return result;
        },
        create: async ({ data }) => {
          const [row] = await table(names[uid]).insert({ payload: data,
            ...(uid.includes('byemoney-cart') ? { cart_id: data.cartId } : {}),
            ...(uid.includes('purchase-log') ? { purchase_id: data.purchaseId } : {}),
          }).returning('*');
          return { ...row.payload, id: row.id };
        },
        update: async ({ where, data }) => {
          const [row] = await table(names[uid]).where({ id: where.id }).update({ payload: knex.raw('payload || ?::jsonb', [JSON.stringify(data)]) }).returning('*');
          return { ...row.payload, id: row.id };
        },
      },
    },
  };
  couponService = couponFactory({ strapi });
  const input = () => ({ cartId: randomUUID(), buyerExternalUserId: 'user-a', externalCourseIds: ['course-b', 'course-a'], couponCode: 'OFF' });
  const reset = async () => {
    for (const name of ['carts', 'coupons', 'courses', 'users', 'logs']) await table(name).delete();
    await table('coupons').insert({ code: 'OFF', used_count: 0 });
    await table('users').insert([{ payload: { documentId: 'user-a', confirmed: true, blocked: false, courses: [] } },
      { payload: { documentId: 'user-b', confirmed: true, blocked: false, courses: [] } }]);
    await table('courses').insert(['a', 'b'].map(id => ({ payload: { documentId: `course-${id}`, price: 105,
      title: `دوره ${id}`, slug: id, publishedAt: new Date().toISOString(), chapters: [], users_permissions_users: [] } })));
  };
  try {
    await knex.raw('CREATE SCHEMA ??', [schema]);
    for (const name of ['carts', 'courses', 'users', 'logs']) await knex.schema.withSchema(schema).createTable(name, b => {
      b.increments('id'); b.jsonb('payload');
      if (name === 'carts') b.string('cart_id').unique();
      if (name === 'logs') b.string('purchase_id').unique();
    });
    await knex.schema.withSchema(schema).createTable('coupons', b => { b.increments('id'); b.string('code'); b.integer('used_count'); });
    await t.test('پیش‌نمایش مکرر رکورد یا رزرو ایجاد نمی‌کند و پرداخت همان قیمت را تثبیت می‌کند', async () => {
      await reset(); const request = input();
      const previews = await Promise.all(Array.from({ length: 5 }, () => service.preview(strapi, request)));
      for (const quote of previews) assert.equal(quote.priceInNoor, 189);
      assert.equal((await table('carts').select()).length, 0);
      assert.equal((await table('coupons').first()).used_count, 0);
      const reserved = await service.prepare(strapi, request);
      assert.deepEqual(reserved.items, previews[0].courses);
      assert.equal((await table('carts').select()).length, 1);
      assert.equal((await table('coupons').first()).used_count, 1);
    });
    await t.test('تکرار و رقابت همان سبد فقط یک رزرو می‌سازند و قیمت ۱۸۹ ثابت می‌ماند', async () => {
      await reset(); const request = input();
      const results = await Promise.all(Array.from({ length: 5 }, () => service.prepare(strapi, request)));
      for (const quote of results) assert.equal(quote.items.reduce((sum, row) => sum + row.priceInNoor, 0), 189);
      assert.equal((await table('carts').select()).length, 1);
      assert.equal((await table('coupons').first()).used_count, 1);
      await table('courses').update({ payload: knex.raw("payload || '{\"price\":999}'::jsonb") });
      assert.deepEqual(await service.prepare(strapi, request), results[0]);
    });
    await t.test('قیمت رزرو قبلی ثابت و قیمت سبد جایگزین پس از آزادسازی به‌روز است', async () => {
      await reset();
      const previous = input();
      const frozen = await service.prepare(strapi, previous);
      await table('courses').update({ payload: knex.raw("jsonb_set(payload, '{price}', '205'::jsonb)") });
      await service.transition(strapi, previous, 'check');
      assert.deepEqual(await service.prepare(strapi, previous), frozen);
      await service.transition(strapi, previous, 'release');
      const fresh = await service.prepare(strapi, { ...previous, cartId: randomUUID() });
      assert.equal(fresh.items.reduce((sum, item) => sum + item.priceInNoor, 0), 369);
      assert.equal(Number((await table('coupons').first()).used_count), 1);
    });
    await t.test('حذف انتشار دوره، بررسی پیش از خرید سبد آماده را رد می‌کند', async () => {
      await reset();
      const cart = input();
      await service.prepare(strapi, cart);
      await table('courses').update({ payload: knex.raw("jsonb_set(payload, '{publishedAt}', 'null'::jsonb)") });
      await assert.rejects(service.transition(strapi, cart, 'check'), error => error.status === 409);
      assert.equal(await table('logs').count('* as count').first().then(row => Number(row.count)), 0);
    });
    await t.test('آخرین ظرفیت کوپن میان دو سبد فقط به یکی می‌رسد و آزادسازی تکراری یک بار است', async () => {
      await reset(); const first = input(); const second = { ...input(), buyerExternalUserId: 'user-b' };
      const results = await Promise.allSettled([service.prepare(strapi, first), service.prepare(strapi, second)]);
      assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
      const winner = results[0].status === 'fulfilled' ? first : second;
      await service.transition(strapi, winner, 'release'); await service.transition(strapi, winner, 'release');
      assert.equal((await table('coupons').first()).used_count, 0);
      await assert.rejects(service.prepare(strapi, winner));
    });
    await t.test('تحویل تمام دوره‌ها و کوپن در تکرار و رقابت یک بار نهایی می‌شوند', async () => {
      await reset(); const request = input(); await service.prepare(strapi, request);
      const commit = { ...request, purchaseIds: [randomUUID(), randomUUID()] };
      await Promise.all([service.transition(strapi, commit, 'commit'), service.transition(strapi, commit, 'commit')]);
      assert.equal((await table('logs').select()).length, 2);
      assert.equal((await table('coupons').first()).used_count, 1);
      const user = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { documentId: 'user-a' }, populate: ['courses'] });
      assert.deepEqual(user.courses.map(course => course.documentId).sort(), ['course-a', 'course-b']);
      await assert.rejects(service.transition(strapi, commit, 'release'));
      await assert.rejects(service.transition(strapi, { ...commit, purchaseIds: [randomUUID(), randomUUID()] }, 'commit'));
    });
    await t.test('خطای قلم دوم کل تحویل را rollback می‌کند و رزرو برای بازیابی می‌ماند', async () => {
      await reset(); const request = input(); await service.prepare(strapi, request);
      await table('courses').whereRaw("payload->>'documentId' = 'course-b'").delete();
      await assert.rejects(service.transition(strapi, { ...request, purchaseIds: [randomUUID(), randomUUID()] }, 'commit'));
      assert.equal((await table('logs').select()).length, 0);
      const user = await table('users').whereRaw("payload->>'documentId' = 'user-a'").first();
      assert.deepEqual(user.payload.courses, []);
      assert.equal((await table('carts').first()).payload.state, 'reserved');
    });
    await t.test('آزادسازی پیش از پاسخ آماده‌سازی، رزرو دیرهنگام نمی‌سازد', async () => {
      await reset(); const request = input(); await service.transition(strapi, request, 'release');
      await assert.rejects(service.prepare(strapi, request));
      assert.equal((await table('coupons').first()).used_count, 0);
    });
    await t.test('مالکیت قدیمی یک دوره کل سبد را بدون مصرف کوپن رد می‌کند', async () => {
      await reset();
      const course = await table('courses').whereRaw("payload->>'documentId' = 'course-a'").first();
      await table('users').whereRaw("payload->>'documentId' = 'user-a'").update({
        payload: knex.raw('payload || ?::jsonb', [JSON.stringify({ courses: [course.id] })]),
      });
      await assert.rejects(service.prepare(strapi, input()));
      assert.equal((await table('coupons').first()).used_count, 0);
      assert.equal((await table('carts').select()).length, 0);
    });
    await t.test('خرید هم‌زمان دو کاربر رابطهٔ مشترک دوره را از دست نمی‌دهد', async () => {
      await reset();
      const first = { ...input(), couponCode: null };
      const second = { ...input(), couponCode: null, buyerExternalUserId: 'user-b' };
      await Promise.all([service.prepare(strapi, first), service.prepare(strapi, second)]);
      await Promise.all([first, second].map(request => service.transition(strapi,
        { ...request, purchaseIds: [randomUUID(), randomUUID()] }, 'commit')));
      for (const course of await table('courses').select()) assert.equal(course.payload.users_permissions_users.length, 2);
      for (const user of await table('users').select()) assert.equal(user.payload.courses.length, 2);
    });
  } finally {
    await knex.raw('DROP SCHEMA ?? CASCADE', [schema]); await knex.destroy();
  }
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');
const knexFactory = require('knex');
const couponFactory = require('../src/api/coupon/services/coupon');
const { createCheckout } = require('../src/api/order/services/checkout-pricing');

// اتصال فقط از محیط آزمون می‌آید؛ تمام داده‌ها در schema موقت مستقل ساخته می‌شوند.
test('رقابت و بازگشت مصرف کوپن روی PostgreSQL', { skip: !process.env.ORDER_PRICE_TEST_DB }, async t => {
  const knex = knexFactory({ client: 'pg', connection: JSON.parse(process.env.ORDER_PRICE_TEST_DB), pool: { min: 0, max: 4 } });
  const schema = 'bm_hotfix_' + randomUUID().replaceAll('-', '');
  const storage = new AsyncLocalStorage();
  const table = name => (storage.getStore() || knex)(`${schema}.${name}`);
  const record = row => ({ id: row.id, documentId: 'coupon-one', code: row.code, usedCount: row.used_count,
    maxUsage: 1, isActive: true, discountType: 'percentage', discountValue: 100, appliesToAllCourses: true });
  let service;
  const strapi = { contentType: () => ({}), service: () => service,
    documents: uid => uid === 'api::course.course' ? { findOne: async () => ({ id: 7, documentId: 'course-seven', price: 101, title: 'دوره', slug: 'course' }) }
      : { findMany: async () => (await table('coupons').select()).map(record) },
    db: { metadata: { get: () => ({ tableName: `${schema}.coupons`, attributes: { code: { columnName: 'code' } } }) },
      transaction: fn => storage.getStore() ? fn({ trx: storage.getStore() }) : knex.transaction(trx => storage.run(trx, () => fn({ trx }))),
      query: () => ({ findMany: async ({ where }) => (await table('coupons').whereRaw('LOWER(code) = LOWER(?)', [where.code.$eqi])).map(record),
        update: ({ where, data }) => table('coupons').where(where).update({ used_count: data.usedCount }) }) },
  };
  service = couponFactory({ strapi });
  const input = { user: 5, cartItems: [{ type: 'course', documentId: 'course-seven', price: 0 }], couponCode: 'FREE' };
  const save = async data => { await table('orders').insert({ total_price: data.totalPrice, payment_status: data.paymentStatus }); return data; };
  const reset = async () => { await table('orders').del(); await table('coupons').del(); await table('coupons').insert({ code: 'FREE' }); };
  try {
    await knex.raw('CREATE SCHEMA ??', [schema]);
    await knex.schema.withSchema(schema).createTable('coupons', b => { b.increments('id'); b.text('code'); b.integer('used_count').notNullable().defaultTo(0); });
    await knex.schema.withSchema(schema).createTable('orders', b => { b.increments('id'); b.integer('total_price'); b.text('payment_status'); });
    await t.test('آخرین ظرفیت کوپن فقط یک سفارش رایگان می‌سازد', async () => {
      await reset();
      const results = await Promise.allSettled([createCheckout(strapi, input, save), createCheckout(strapi, input, save)]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal((await table('coupons').first()).used_count, 1);
      const orders = await table('orders').select(); assert.equal(orders.length, 1); assert.equal(orders[0].payment_status, 'paid');
    });
    await t.test('شکست ذخیره سفارش مصرف کوپن را برمی‌گرداند', async () => {
      await reset();
      await assert.rejects(createCheckout(strapi, input, async () => { throw new Error('save failed'); }), /save failed/);
      assert.equal((await table('coupons').first()).used_count, 0);
      assert.equal((await table('orders').select()).length, 0);
      await createCheckout(strapi, input, save);
      assert.equal((await table('coupons').first()).used_count, 1);
    });
  } finally {
    try { if (/^bm_hotfix_[a-f0-9]{32}$/.test(schema)) await knex.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [schema]); }
    finally { await knex.destroy(); }
  }
});

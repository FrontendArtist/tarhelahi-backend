'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');
const knexFactory = require('knex');
const { createCheckout } = require('../src/api/order/services/checkout-pricing');

// Uses only an explicitly configured test database and an isolated temporary schema.
test('concurrent pending checkout and rollback on PostgreSQL', { skip: !process.env.ORDER_PRICE_TEST_DB }, async t => {
  const knex = knexFactory({ client: 'pg', connection: JSON.parse(process.env.ORDER_PRICE_TEST_DB), pool: { min: 0, max: 4 } });
  const schema = 'pending_checkout_' + randomUUID().replaceAll('-', '');
  const storage = new AsyncLocalStorage();
  const table = () => (storage.getStore() || knex)(`${schema}.orders`);
  const strapi = {
    documents: () => ({ findOne: async () => ({ id: 7, documentId: 'course-seven', title: 'Course', slug: 'course', price: 100 }) }),
    db: {
      transaction: fn => knex.transaction(trx => storage.run(trx, () => fn({ trx }))),
      query: () => ({ findMany: async ({ where }) => (await table().where({ user_id: where.user.id }).select()).map(row => row.payload),
        updateMany: async ({ where, data }) => ({ count: await table().where({ id: where.id, ...(where.user ? { user_id: where.user.id } : {}) })
          .whereRaw("payload->>'orderStatus' = ? AND payload->>'paymentStatus' = ? AND payload->>'paymentMethod' = ? AND payload->>'refNum' IS NULL",
            [where.orderStatus, where.paymentStatus, where.paymentMethod])
          .update({ payload: knex.raw('payload || ?::jsonb', [JSON.stringify(data)]) }) }) }),
    },
  };
  const input = { user: 5, paymentMethod: 'online', cartItems: [{ type: 'course', documentId: 'course-seven' }],
    address: 'Tehran', postalCode: '123', phone: '09120000000', fullName: 'Buyer', email: 'a@example.com' };
  const save = async data => {
    const order = { ...data, documentId: randomUUID(), createdAt: new Date().toISOString(), publishedAt: new Date().toISOString() };
    const [row] = await table().insert({ user_id: data.user, payload: order }).returning('id');
    order.id = row.id;
    await table().where({ id: row.id }).update({ payload: order });
    return order;
  };
  try {
    await knex.raw('CREATE SCHEMA ??', [schema]);
    await knex.schema.withSchema(schema).createTable('orders', b => { b.increments('id'); b.integer('user_id'); b.jsonb('payload'); });
    await t.test('parallel requests across transactions return one order', async () => {
      const results = await Promise.all(Array.from({ length: 4 }, () => createCheckout(strapi, input, save)));
      assert.equal(new Set(results.map(order => order.documentId)).size, 1);
      assert.equal((await table().select()).length, 1);
    });
    await t.test('save rollback releases lock and allows next checkout', async () => {
      const differentInput = { ...input, address: 'Shiraz' };
      await assert.rejects(createCheckout(strapi, differentInput, async data => {
        await save(data); throw new Error('save failed');
      }), /save failed/);
      assert.equal((await table().select()).length, 1);
      assert.equal((await table().first()).payload.orderStatus, 'pending');
      const next = await createCheckout(strapi, differentInput, save);
      assert.equal(next.address, 'Shiraz');
      assert.equal((await table().select()).length, 2);
      assert.equal((await table().whereNot({ id: next.id }).first()).payload.orderStatus, 'canceled');
    });
  } finally {
    try {
      if (/^pending_checkout_[a-f0-9]{32}$/.test(schema)) await knex.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [schema]);
    } finally { await knex.destroy(); }
  }
});

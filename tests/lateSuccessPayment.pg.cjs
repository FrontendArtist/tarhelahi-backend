'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const knexFactory = require('knex');
const stock = require('../src/services/stockReservation');
const { documentMiddleware } = require('../src/services/physicalStockMiddleware');
const { cancelAfterCartRemoval } = require('../src/api/order/services/abandoned-order');

const ORDER_UID = 'api::order.order';
const matches = (row, where) => Object.entries(where).every(([key, value]) => {
  if (key === 'user') return row.user?.id === value.id;
  if (value && value.$null) return row[key] == null;
  return row[key] === value;
});

test('پرداخت موفق دیرهنگام پس از آزادسازی آخرین واحد روی PostgreSQL', {
  skip: process.env.PHYSICAL_STOCK_PG_TESTS !== '1',
}, async (t) => {
  const local = require('dotenv').config({ quiet: true }).parsed || {};
  const config = { ...local, ...process.env };
  const knex = knexFactory({
    client: 'pg',
    connection: {
      host: config.DATABASE_HOST || '127.0.0.1',
      port: Number(config.DATABASE_PORT || 5432),
      database: config.DATABASE_NAME || 'tarhelahi_db',
      user: config.DATABASE_USERNAME || 'postgres',
      password: config.DATABASE_PASSWORD || '123456',
    },
    pool: { min: 0, max: 8 },
  });
  const schema = `late_success_test_${randomUUID().replaceAll('-', '')}`;
  const storage = new AsyncLocalStorage();
  const table = (name) => (storage.getStore() || knex)(`${schema}.${name}`);
  const transaction = (callback) => knex.transaction(async (trx) => {
    await trx.raw('SET LOCAL search_path TO ??', [schema]);
    return storage.run(trx, () => callback(trx));
  });
  const product = (row) => row && ({
    id: row.id, documentId: row.document_id, stock: row.stock,
    publishedAt: row.published_at, isAvailable: row.is_available,
  });
  const orders = async (where) => (await table('orders').where(where).orderBy('id')).map((row) => row.payload);
  const orderRepository = {
    findMany: async ({ where }) => (await table('orders').select().orderBy('id'))
      .map((row) => row.payload).filter((row) => matches(row, where)),
    updateMany: async ({ where, data }) => {
      const rows = (await table('orders').forUpdate().select().orderBy('id'))
        .filter((row) => matches(row.payload, where));
      for (const row of rows) {
        await table('orders').where({ id: row.id }).update({ payload: { ...row.payload, ...data } });
      }
      return { count: rows.length };
    },
  };
  const strapi = {
    db: {
      connection: knex,
      transaction: (callback) => transaction((trx) => callback({ trx })),
      metadata: { get: () => ({
        tableName: `${schema}.products`,
        attributes: { documentId: { columnName: 'document_id' }, stock: { columnName: 'stock' } },
      }) },
      query: (uid) => uid === ORDER_UID ? orderRepository : {
        findMany: async ({ where }) =>
          (await table('products').where({ document_id: where.documentId }).orderBy('id')).map(product),
        findOne: async ({ where }) => product(await table('products').where(where.id ? { id: where.id } : where).first()),
      },
    },
    documents: () => ({ findOne: async ({ documentId }) =>
      product(await table('products').where({ document_id: documentId }).whereNotNull('published_at').first()) }),
  };
  const middleware = documentMiddleware(strapi);
  const run = (action, params) => middleware({ action, uid: ORDER_UID, params }, async () => {
    if (action === 'create') {
      const documentId = randomUUID();
      const row = { ...params.data, documentId, publishedAt: new Date().toISOString() };
      const [{ id }] = await table('orders').insert({ document_id: documentId, payload: row }).returning('id');
      await table('orders').where({ id }).update({ payload: { ...row, id } });
      return { documentId };
    }
    await orderRepository.updateMany({ where: { documentId: params.documentId }, data: params.data });
    return { documentId: params.documentId };
  });
  const checkout = (userId) => run('create', { data: {
    user: { id: userId }, paymentMethod: 'online', orderStatus: 'pending', paymentStatus: 'pending_payment',
    items: [{ __component: 'order.product-order-item', productId: 1, slug: 'p', quantity: 1 }],
  } });
  const callback = (documentId) => run('update', {
    documentId, data: { orderStatus: 'paid', paymentStatus: 'paid', refNum: 'bank-ref' },
  });
  const quantity = async () => (await table(stock.INVENTORY_TABLE).where({ document_id: 'a' }).first())?.available_quantity;
  const order = async (documentId) => (await orders({ document_id: documentId }))[0];

  try {
    await knex.schema.createSchema(schema);
    await knex.schema.withSchema(schema).createTable('products', (b) => {
      b.increments('id');
      b.string('document_id');
      b.integer('stock');
      b.timestamp('published_at');
      b.boolean('is_available');
    });
    await knex.schema.withSchema(schema).createTable('orders', (b) => {
      b.increments('id');
      b.string('document_id');
      b.jsonb('payload');
    });
    await transaction((trx) => require('../database/migrations/2026.10.22T12.00.00.physical-stock-reservations').up(trx));
    await table('products').insert({ document_id: 'a', stock: 1, published_at: new Date(), is_available: true });

    const { documentId: first } = await checkout(1);
    assert.equal(await quantity(), 0, 'نفر اول آخرین واحد را رزرو کرده است');
    assert.deepEqual(
      await cancelAfterCartRemoval(strapi, { userId: 1, removedItemKey: 'product:1', remainingItemKeys: [] }),
      { canceledOrderIds: [first] },
    );
    assert.equal(await quantity(), 1, 'لغو موجودی را آزاد کرده است');
    const { documentId: second } = await checkout(2);
    assert.equal(await quantity(), 0, 'نفر دوم آخرین واحد را خریده است');

    await t.test('callback موفق نفر اول paid نمی‌شود و بررسی دستی ثبت می‌شود', async () => {
      await callback(first);
      const late = await order(first);
      assert.equal(late.orderStatus, 'canceled');
      assert.equal(late.paymentStatus, 'pending_verification');
      assert.match(late.rejectionReason, /نیازمند بررسی دستی/);
      assert.equal(late.refNum, 'bank-ref');
      assert.equal(late.stockDeducted, false);
    });

    await t.test('موجودی و سفارش نفر دوم دست‌نخورده می‌ماند و بیش‌فروش نیست', async () => {
      assert.equal(await quantity(), 0);
      assert.equal((await order(second)).stockDeducted, true);
      const reservations = await table(stock.RESERVATION_TABLE).orderBy('reservation_id');
      assert.deepEqual(reservations.map((row) => row.state).sort(), ['released', 'reserved']);
    });

    await t.test('تکرار و رقابت callback اثر مضاعف ندارد', async () => {
      await Promise.all([callback(first), callback(first), callback(first)]);
      assert.equal(await quantity(), 0);
      assert.equal((await order(first)).paymentStatus, 'pending_verification');
      assert.equal((await table(stock.RESERVATION_TABLE)).length, 2);
    });

    await t.test('پرداخت عادی نفر دوم بدون تغییر قبلی کار می‌کند', async () => {
      await callback(second);
      const paid = await order(second);
      assert.equal(paid.paymentStatus, 'paid');
      assert.equal(await quantity(), 0);
      assert.equal((await table(stock.RESERVATION_TABLE).where({ state: 'committed' })).length, 1);
    });
  } finally {
    await knex.schema.dropSchemaIfExists(schema, true);
    await knex.destroy();
  }
});

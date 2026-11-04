'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const knexFactory = require('knex');
const stock = require('../src/services/stockReservation');
const physicalCart = require('../src/services/physicalCartService');

test('رزرو اتمیک کالای فیزیکی روی PostgreSQL', {
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
  const schema = `physical_stock_test_${randomUUID().replaceAll('-', '')}`;
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
  const carts = new Map();
  const strapi = {
    db: {
      connection: knex,
      transaction: (callback) => transaction((trx) => callback({ trx })),
      metadata: { get: () => ({
        tableName: `${schema}.products`,
        attributes: { documentId: { columnName: 'document_id' }, stock: { columnName: 'stock' } },
      }) },
      query: (uid) => uid === 'api::byemoney-cart.byemoney-cart'
        ? { findOne: async ({ where }) => carts.get(where.cartId) || null }
        : { findMany: async ({ where }) =>
          (await table('products').where({ document_id: where.documentId }).orderBy('id')).map(product) },
    },
    documents: () => ({ findOne: async ({ documentId }) =>
      product(await table('products').where({ document_id: documentId }).whereNotNull('published_at').first()) }),
  };
  const item = (externalId, quantity = 1) => ({ externalId, quantity });
  const reserve = (id, items) => transaction((trx) => stock.reserve(strapi, trx, id, items));
  const transition = (id, action) => transaction((trx) => stock.transition(strapi, trx, id, action));
  const quantity = async (id) => (await table(stock.INVENTORY_TABLE).where({ document_id: id }).first())?.available_quantity;
  const reset = async (count = 1) => {
    carts.clear();
    await table(stock.RETURN_TABLE).delete();
    await table(stock.RESERVATION_TABLE).delete();
    await table(stock.INVENTORY_TABLE).delete();
    await table('products').delete();
    await table('products').insert(['a', 'b'].flatMap((id) => [
      { document_id: id, stock: count, published_at: new Date(), is_available: true },
      { document_id: id, stock: 999, published_at: null, is_available: true },
    ]));
  };
  try {
    await knex.schema.createSchema(schema);
    await knex.schema.withSchema(schema).createTable('products', (b) => {
      b.increments('id');
      b.string('document_id');
      b.integer('stock');
      b.timestamp('published_at');
      b.boolean('is_available');
    });
    await transaction((trx) => require('../database/migrations/2026.10.22T12.00.00.physical-stock-reservations').up(trx));
    await transaction((trx) => require('../database/migrations/2026.11.03T12.00.00.physical-stock-returns').up(trx));

    await t.test('دو خریدار آخرین واحد را نمی‌خرند و دو نسخه یک موجودی دارند', async () => {
      await reset();
      const results = await Promise.allSettled([
        reserve('buyer-a', [item('a')]), reserve('buyer-b', [item('a')]),
      ]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(results.find((result) => result.status === 'rejected').reason.lineError.reason, 'OUT_OF_STOCK');
      assert.equal(await quantity('a'), 0);
      assert.deepEqual((await table('products').where({ document_id: 'a' })).map((row) => row.stock), [0, 0]);
      assert.equal((await table(stock.RESERVATION_TABLE)).length, 1);
    });

    await t.test('تعداد بیشتر از موجودی بدون تغییر موجودی رد می‌شود', async () => {
      await reset(2);
      await assert.rejects(reserve('too-many', [item('a', 3)]), (error) => {
        assert.deepEqual(error.lineError, {
          externalId: 'a', type: 'product', quantity: 3, reason: 'INSUFFICIENT_STOCK', availableQuantity: 2,
        });
        return true;
      });
      assert.equal((await table(stock.RESERVATION_TABLE)).length, 0);
      assert.equal((await table('products').whereNotNull('published_at').first()).stock, 2);
    });

    await t.test('شکست قلم دوم هیچ رزرو جزئی باقی نمی‌گذارد', async () => {
      await reset();
      await assert.rejects(reserve('partial', [item('b', 2), item('a')]), (error) => error.lineError.externalId === 'b');
      assert.equal((await table(stock.RESERVATION_TABLE)).length, 0);
      assert.equal((await table(stock.INVENTORY_TABLE)).length, 0);
      assert.equal((await table('products').where({ document_id: 'a' }).whereNotNull('published_at').first()).stock, 1);
    });

    await t.test('تکرار رزرو و تثبیت کاهش دوم ندارد و تغییر اقلام تعارض است', async () => {
      await reset(3);
      const first = await reserve('same', [item('a', 2)]);
      const second = await reserve('same', [item('a', 2)]);
      assert.equal(first.reservation_id, second.reservation_id);
      assert.equal(await quantity('a'), 1);
      await assert.rejects(reserve('same', [item('a')]), (error) => error.code === 'CART_CONFLICT');
      await transition('same', 'check');
      await transition('same', 'commit');
      await transition('same', 'commit');
      assert.equal(await quantity('a'), 1);
      await assert.rejects(transition('same', 'release'), (error) => error.status === 409);
      assert.equal(await quantity('a'), 1);
    });

    await t.test('آزادسازی تکراری فقط یک بار موجودی را برمی‌گرداند', async () => {
      await reset(2);
      await reserve('release', [item('a', 2)]);
      await Promise.all([transition('release', 'release'), transition('release', 'release')]);
      assert.equal(await quantity('a'), 2);
      assert.deepEqual((await table('products').where({ document_id: 'a' })).map((row) => row.stock), [2, 2]);
      await assert.rejects(transition('release', 'commit'));
      await assert.rejects(reserve('release', [item('a', 2)]));
    });

    await t.test('رقابت آزادسازی و تثبیت دقیقاً یک نتیجهٔ نهایی دارد', async () => {
      for (let index = 0; index < 10; index += 1) {
        await reset();
        await reserve('race', [item('a')]);
        const operations = index % 2 === 0 ? ['release', 'commit'] : ['commit', 'release'];
        const results = await Promise.allSettled(operations.map((action) => transition('race', action)));
        assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
        const reservation = await table(stock.RESERVATION_TABLE).where({ reservation_id: 'race' }).first();
        assert.equal(await quantity('a'), reservation.state === 'released' ? 1 : 0);
      }
    });

    await t.test('رزرو اقلام با ترتیب معکوس بن‌بست و رزرو جزئی نمی‌سازد', async () => {
      await reset();
      const results = await Promise.allSettled([
        reserve('ordered-a', [item('b'), item('a')]), reserve('ordered-b', [item('a'), item('b')]),
      ]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(await quantity('a'), 0);
      assert.equal(await quantity('b'), 0);
    });

    await t.test('توقف فروش و حذف انتشار در check مشخص می‌شود؛ صفر موجودی رزرو خود خریدار را رد نمی‌کند', async () => {
      await reset();
      await reserve('held', [item('a')]);
      await transition('held', 'check');
      await table('products').where({ document_id: 'a' }).update({ is_available: false });
      await assert.rejects(transition('held', 'check'), (error) => error.lineError.reason === 'SALE_STOPPED');
      await transition('held', 'release');
      assert.equal(await quantity('a'), 1);
      assert.equal((await table('products').where({ document_id: 'a' }).first()).is_available, false);
    });

    await t.test('انقضا به‌تنهایی رزرو نتیجهٔ بانکی نامعلوم را آزاد نمی‌کند', async () => {
      await reset();
      await reserve('unknown-bank', [item('a')]);
      await table(stock.RESERVATION_TABLE).where({ reservation_id: 'unknown-bank' }).update({ expires_at: new Date(0) });
      await transition('unknown-bank', 'check');
      assert.equal(await quantity('a'), 0);
      await transition('unknown-bank', 'commit');
      assert.equal(await quantity('a'), 0);
    });

    await t.test('برگشت موجودی پس از لغو: تعداد دقیق، تکرار و هم‌زمانی بدون برگشت مضاعف', async () => {
      await reset(5);
      await reserve('cart-1', [item('a', 5)]);
      await transition('cart-1', 'commit');
      assert.equal(await quantity('a'), 0);
      const restock = (operationId, count, purchaseId = 'p1') => transaction((trx) => stock.restock(strapi, trx, {
        operationId, cartId: 'cart-1',
        lines: [{ purchaseId, externalId: 'a', quantity: count, maxQuantity: 5 }],
      }));
      assert.equal((await restock('op-1', 2)).restocked, true);
      assert.equal(await quantity('a'), 2);
      assert.equal((await restock('op-1', 2)).restocked, false);
      assert.equal(await quantity('a'), 2);
      await assert.rejects(restock('op-1', 3), { code: 'CART_CONFLICT' });
      const racing = await Promise.allSettled([restock('op-2', 3), restock('op-2', 3), restock('op-2', 3)]);
      assert.equal(racing.filter((r) => r.status === 'fulfilled' && r.value.restocked).length, 1);
      assert.equal(await quantity('a'), 5);
      await assert.rejects(restock('op-3', 1), { code: 'CART_CONFLICT' });
      assert.equal(await quantity('a'), 5);
      assert.equal((await table('products').where({ document_id: 'a', is_available: true }).whereNotNull('published_at').first()).stock, 5);
    });

    await t.test('برگشت موجودی از مسیر سبد: تطبیق purchaseIds، رد سبد و قلم نامعتبر، سقف خرید و تکرار', async () => {
      await reset(5);
      const cartId = randomUUID();
      const [p1, p2, p3] = [randomUUID(), randomUUID(), randomUUID()];
      await reserve(cartId, [item('a', 3), item('b', 2)]);
      await transition(cartId, 'commit');
      carts.set(cartId, {
        cartId, state: 'committed', purchaseIds: [p1, p2, p3],
        snapshot: { items: [
          { type: 'product', externalId: 'a', quantity: 3 },
          { type: 'course', externalId: 'course-1', quantity: 1 },
          { type: 'product', externalId: 'b', quantity: 2 },
        ] },
      });
      const reservedId = randomUUID();
      carts.set(reservedId, { cartId: reservedId, state: 'reserved', snapshot: { items: [] } });
      const versions = async (id) => (await table('products').where({ document_id: id }).orderBy('id')).map((row) => row.stock);
      const returns = async () => Number((await table(stock.RETURN_TABLE).count({ count: '*' }).first()).count);
      const restock = (operationId, items, id = cartId) => physicalCart.restock(strapi, { cartId: id, operationId, items });
      const [op1, op2] = [randomUUID(), randomUUID()];
      assert.equal(await quantity('a'), 2);
      assert.equal(await quantity('b'), 3);

      await assert.rejects(restock('op-1', [{ purchaseId: p1, quantity: 1 }]), { status: 400, code: 'CART_INVALID' });
      await assert.rejects(restock(op1, [{ purchaseId: p1, quantity: 0 }]), { status: 400, code: 'CART_INVALID' });
      await assert.rejects(restock(op1, [{ purchaseId: p1, quantity: 1 }, { purchaseId: p1, quantity: 1 }]),
        { status: 400, code: 'CART_INVALID' });
      await assert.rejects(restock(op1, [{ purchaseId: p1, quantity: 1 }], randomUUID()), { status: 409, code: 'CART_CONFLICT' });
      await assert.rejects(restock(op1, [{ purchaseId: p1, quantity: 1 }], reservedId), { status: 409, code: 'CART_CONFLICT' });
      await assert.rejects(restock(op1, [{ purchaseId: randomUUID(), quantity: 1 }]), { status: 409, code: 'CART_CONFLICT' });
      await assert.rejects(restock(op1, [{ purchaseId: p2, quantity: 1 }]), { status: 409, code: 'CART_CONFLICT' });
      await assert.rejects(restock(op1, [{ purchaseId: p1, quantity: 4 }]), { status: 409, code: 'CART_CONFLICT' });
      assert.equal(await quantity('a'), 2);
      assert.equal(await returns(), 0);

      assert.deepEqual(await restock(op1, [{ purchaseId: p3, quantity: 1 }, { purchaseId: p1, quantity: 2 }]),
        { success: true, restocked: true });
      assert.equal(await quantity('a'), 4);
      assert.equal(await quantity('b'), 4);
      // نسخهٔ draft و published شمارندهٔ یکسان آینه را می‌گیرند.
      assert.deepEqual(await versions('a'), [4, 4]);
      assert.deepEqual(await versions('b'), [4, 4]);
      assert.deepEqual(await restock(op1, [{ purchaseId: p1, quantity: 2 }, { purchaseId: p3, quantity: 1 }]),
        { success: true, restocked: false });
      await assert.rejects(restock(op1, [{ purchaseId: p1, quantity: 1 }, { purchaseId: p3, quantity: 1 }]),
        { status: 409, code: 'CART_CONFLICT' });
      await assert.rejects(restock(op2, [{ purchaseId: p1, quantity: 2 }]), { status: 409, code: 'CART_CONFLICT' });
      await assert.rejects(restock(op2, [{ purchaseId: p3, quantity: 2 }]), { status: 409, code: 'CART_CONFLICT' });
      assert.equal(await quantity('a'), 4);
      assert.equal(await quantity('b'), 4);
      assert.deepEqual(await restock(op2, [{ purchaseId: p1, quantity: 1 }]), { success: true, restocked: true });
      assert.equal(await quantity('a'), 5);
      assert.deepEqual(await versions('a'), [5, 5]);
    });

    await t.test('migration برگشت موجودی down و up دوباره سالم است', async () => {
      const migration = require('../database/migrations/2026.11.03T12.00.00.physical-stock-returns');
      const exists = () => knex.schema.withSchema(schema).hasTable(stock.RETURN_TABLE);
      await transaction((trx) => migration.down(trx));
      assert.equal(await exists(), false);
      await transaction((trx) => migration.down(trx));
      await transaction((trx) => migration.up(trx));
      await transaction((trx) => migration.up(trx));
      assert.equal(await exists(), true);
      await assert.rejects(table(stock.RETURN_TABLE).insert({ operation_id: 'o', purchase_id: 'p', cart_id: 'c',
        document_id: 'a', quantity: 0, created_at: new Date() }), /physical_stock_returns_quantity_positive/);
    });
  } finally {
    await knex.schema.dropSchemaIfExists(schema, true);
    await knex.destroy();
  }
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const financialEnums = require('../src/services/financialEnums');
const { asyncLocalStorage } = require('../src/utils/uploadPath');
const orderLifecycles = require('../src/api/order/content-types/order/lifecycles');
const attemptLifecycles = require('../src/api/gateway-payment-attempt/content-types/gateway-payment-attempt/lifecycles');
const excelExport = require('../src/api/order/services/excel-export');
const physicalStockMiddleware = require('../src/services/physicalStockMiddleware');

const SCHEMA_PATHS = {
  'api::order.order': 'src/api/order/content-types/order/schema.json',
  'api::coupon.coupon': 'src/api/coupon/content-types/coupon/schema.json',
  'api::gateway-payment-attempt.gateway-payment-attempt': 'src/api/gateway-payment-attempt/content-types/gateway-payment-attempt/schema.json',
  'api::gateway-payment-event.gateway-payment-event': 'src/api/gateway-payment-event/content-types/gateway-payment-event/schema.json',
  'api::gateway-review-case.gateway-review-case': 'src/api/gateway-review-case/content-types/gateway-review-case/schema.json',
  'api::gateway-review-case-history.gateway-review-case-history': 'src/api/gateway-review-case-history/content-types/gateway-review-case-history/schema.json',
  'api::gateway-review-operation.gateway-review-operation': 'src/api/gateway-review-operation/content-types/gateway-review-operation/schema.json',
  'api::byemoney-cart.byemoney-cart': 'src/api/byemoney-cart/content-types/byemoney-cart/schema.json',
  'api::byemoney-purchase-log.byemoney-purchase-log': 'src/api/byemoney-purchase-log/content-types/byemoney-purchase-log/schema.json',
};

test('all 9 schema.json files match FINANCIAL_ENUMS exactly with unique 1-to-1 Persian labels', () => {
  for (const [uid, relPath] of Object.entries(SCHEMA_PATHS)) {
    const raw = fs.readFileSync(path.resolve(__dirname, '..', relPath), 'utf8');
    const schema = JSON.parse(raw);
    const expectedFields = financialEnums.FINANCIAL_ENUMS[uid];
    assert.ok(expectedFields, `Missing FINANCIAL_ENUMS entry for ${uid}`);

    const schemaEnumFields = Object.entries(schema.attributes)
      .filter(([, attr]) => attr?.type === 'enumeration')
      .map(([name]) => name)
      .sort();
    assert.deepEqual(
      schemaEnumFields,
      Object.keys(expectedFields).sort(),
      `Enumeration field mismatch in ${uid}`,
    );

    for (const [field, codeToLabel] of Object.entries(expectedFields)) {
      const attr = schema.attributes[field];
      const labels = Object.values(codeToLabel);
      assert.equal(new Set(labels).size, labels.length, `Duplicate Persian labels in ${uid}.${field}`);
      assert.deepEqual(attr.enum, labels, `Schema enum mismatch in ${uid}.${field}`);
      if (attr.default !== undefined) {
        assert.ok(attr.enum.includes(attr.default), `Default "${attr.default}" not in enum for ${uid}.${field}`);
      }
    }
  }
});

test('toLabel and toCode round-trip and are idempotent for every enum value', () => {
  for (const [uid, fields] of Object.entries(financialEnums.FINANCIAL_ENUMS)) {
    for (const [field, codeToLabel] of Object.entries(fields)) {
      for (const [code, label] of Object.entries(codeToLabel)) {
        assert.equal(financialEnums.toLabel(uid, field, code), label);
        assert.equal(financialEnums.toLabel(uid, field, label), label);
        assert.equal(financialEnums.toLabel(uid, field, code.toUpperCase()), label);

        assert.equal(financialEnums.toCode(uid, field, label), code);
        assert.equal(financialEnums.toCode(uid, field, code), code);
        assert.equal(financialEnums.toCode(uid, field, code.toUpperCase()), code);
      }
    }
  }
  assert.equal(financialEnums.toLabel('api::order.order', 'orderStatus', null), null);
  assert.equal(financialEnums.toCode('api::order.order', 'orderStatus', undefined), undefined);
  assert.equal(financialEnums.toLabel('api::order.order', 'orderStatus', 'unknown_val'), 'unknown_val');
});

test('translateDataToLabels does not mutate caller object and is idempotent', () => {
  const input = {
    orderStatus: 'paid',
    paymentMethod: 'card_to_card',
    paymentStatus: 'pending_verification',
    currency: 'noor',
    totalPrice: 1000,
  };
  const translated = financialEnums.translateDataToLabels('api::order.order', input);
  assert.equal(input.orderStatus, 'paid');
  assert.equal(translated.orderStatus, 'پرداخت شده');
  assert.equal(translated.paymentMethod, 'کارت به کارت');
  assert.equal(translated.paymentStatus, 'در انتظار تأیید');
  assert.equal(translated.currency, 'نور');
  assert.equal(translated.totalPrice, 1000);
  assert.deepEqual(financialEnums.translateDataToLabels('api::order.order', translated), translated);
});

test('translateWhereToLabels translates nested operators, logical groups, and related orders without mutation', () => {
  const originalFilter = {
    $and: [
      { orderStatus: { $in: ['pending', 'paid'] } },
      { $or: [{ paymentMethod: 'online' }, { paymentStatus: { $ne: 'failed' } }] },
      { $not: { currency: { $eqi: 'toman' } } },
    ],
  };
  const translated = financialEnums.translateWhereToLabels('api::order.order', originalFilter);
  assert.deepEqual(originalFilter.$and[0].orderStatus.$in, ['pending', 'paid']);
  assert.deepEqual(translated.$and[0].orderStatus.$in, ['در انتظار', 'پرداخت شده']);
  assert.equal(translated.$and[1].$or[0].paymentMethod, 'آنلاین');
  assert.equal(translated.$and[1].$or[1].paymentStatus.$ne, 'ناموفق');
  assert.equal(translated.$and[2].$not.currency.$eqi, 'تومان');

  const settlementWhere = { orders: { paymentStatus: { $eq: 'paid' } } };
  const translatedSettlement = financialEnums.translateWhereToLabels('api::settlement.settlement', settlementWhere);
  assert.equal(settlementWhere.orders.paymentStatus.$eq, 'paid');
  assert.equal(translatedSettlement.orders.paymentStatus.$eq, 'پرداخت شده');
});

test('documentMiddleware translates writes/filters to Persian and returns English outside Content Manager', async () => {
  const mw = financialEnums.documentMiddleware();
  const seenParams = [];
  const next = async (ctx) => {
    seenParams.push(JSON.parse(JSON.stringify(ctx.params)));
    return [
      { id: 1, orderStatus: 'پرداخت شده', paymentMethod: 'آنلاین', paymentStatus: 'پرداخت شده', currency: 'نور' },
    ];
  };

  // No HTTP context (background/API) -> returns English
  const ctxApi = {
    uid: 'api::order.order',
    action: 'create',
    params: {
      filters: { orderStatus: 'pending' },
      data: { orderStatus: 'paid', paymentMethod: 'online', paymentStatus: 'paid', currency: 'noor' },
    },
  };
  const apiRes = await mw(ctxApi, () => next(ctxApi));
  assert.equal(seenParams[0].filters.orderStatus, 'در انتظار');
  assert.equal(seenParams[0].data.orderStatus, 'پرداخت شده');
  assert.equal(apiRes[0].orderStatus, 'paid');
  assert.equal(apiRes[0].currency, 'noor');

  // Content Manager HTTP context -> keeps Persian
  const ctxCm = {
    uid: 'api::order.order',
    action: 'findMany',
    params: { filters: { paymentStatus: 'pending_verification' } },
  };
  const cmRes = await asyncLocalStorage.run(
    { path: '/content-manager/collection-types/api::order.order' },
    () => mw(ctxCm, () => next(ctxCm)),
  );
  assert.equal(seenParams[1].filters.paymentStatus, 'در انتظار تأیید');
  assert.equal(cmRes[0].orderStatus, 'پرداخت شده');
});

test('registerDbLifecycles translates all hooks to Persian and mutates afterFind in-place', () => {
  let registeredSub = null;
  const fakeStrapi = {
    db: {
      lifecycles: {
        subscribe(sub) {
          registeredSub = sub;
          return () => {};
        },
      },
    },
  };
  financialEnums.registerDbLifecycles(fakeStrapi);
  assert.ok(registeredSub);
  assert.ok(registeredSub.models.includes('api::order.order'));
  assert.ok(registeredSub.models.includes('api::settlement.settlement'));

  const createEv = {
    model: { uid: 'api::gateway-review-case.gateway-review-case' },
    params: { data: { reasonCode: 'NO_CALLBACK', status: 'open', notificationStatus: 'pending' } },
  };
  registeredSub.beforeCreate(createEv);
  assert.equal(createEv.params.data.reasonCode, 'بدون بازگشت از درگاه');
  assert.equal(createEv.params.data.status, 'باز');
  assert.equal(createEv.params.data.notificationStatus, 'در انتظار ارسال');

  const createManyEv = {
    model: { uid: 'api::byemoney-cart.byemoney-cart' },
    params: { data: [{ state: 'reserved' }, { state: 'committed' }] },
  };
  registeredSub.beforeCreateMany(createManyEv);
  assert.deepEqual(createManyEv.params.data.map((d) => d.state), ['رزرو شده', 'نهایی شده']);

  const findEv = {
    model: { uid: 'api::order.order' },
    params: { where: { orderStatus: 'pending' }, filters: { paymentMethod: 'free' } },
  };
  registeredSub.beforeFindMany(findEv);
  assert.equal(findEv.params.where.orderStatus, 'در انتظار');
  assert.equal(findEv.params.filters.paymentMethod, 'رایگان');

  // In-place mutation on afterFindOne (including populated orders on settlement)
  const settlementResult = {
    id: 10,
    orders: [{ id: 1, orderStatus: 'لغو شده', paymentStatus: 'ناموفق' }],
  };
  registeredSub.afterFindOne({
    model: { uid: 'api::settlement.settlement' },
    result: settlementResult,
  });
  assert.equal(settlementResult.orders[0].orderStatus, 'canceled');
  assert.equal(settlementResult.orders[0].paymentStatus, 'failed');

  // Inside Content Manager -> preserves Persian
  const cmResult = { id: 2, orderStatus: 'ارسال شده' };
  asyncLocalStorage.run({ path: '/content-manager/collection-types/api::order.order' }, () => {
    registeredSub.afterFindOne({ model: { uid: 'api::order.order' }, result: cmResult });
  });
  assert.equal(cmResult.orderStatus, 'ارسال شده');
});

test('migrateFinancialEnums updates legacy English values using metadata and skips missing tables', async () => {
  const updates = [];
  const fakeKnex = (tableName) => ({
    where(col, val) {
      return {
        async update(patch) {
          updates.push({ tableName, col, val, patch });
          return 1;
        },
      };
    },
  });
  fakeKnex.schema = {
    async hasTable(t) {
      return t === 'orders';
    },
    async hasColumn(t, c) {
      return t === 'orders' && c === 'order_status';
    },
  };

  const logs = [];
  const fakeStrapi = {
    db: {
      connection: fakeKnex,
      metadata: {
        get(uid) {
          if (uid === 'api::order.order') {
            return {
              tableName: 'orders',
              attributes: {
                orderStatus: { columnName: 'order_status' },
                paymentMethod: { columnName: 'payment_method' },
              },
            };
          }
          return null;
        },
      },
    },
    log: { info: (msg) => logs.push(msg) },
  };

  const res = await financialEnums.migrateFinancialEnums(fakeStrapi);
  assert.equal(res.migrated, 5);
  assert.equal(updates.length, 5);
  assert.deepEqual(updates[0], {
    tableName: 'orders',
    col: 'order_status',
    val: 'shipped',
    patch: { order_status: 'ارسال شده' },
  });
  assert.equal(logs.length, 1);
});

test('order lifecycles, gateway-payment-attempt lifecycles, excel-export, and physicalStockMiddleware work with Persian enums', async () => {
  // 1. excel-export calculateRevenueMetrics with Persian statuses
  const stats = excelExport.calculateRevenueMetrics([
    {
      id: 1,
      orderStatus: 'پرداخت شده',
      paymentStatus: 'پرداخت شده',
      paymentMethod: 'آنلاین',
      totalPrice: 50000,
      currency: 'نور',
      createdAt: new Date().toISOString(),
      items: [],
    },
    {
      id: 2,
      orderStatus: 'لغو شده',
      paymentStatus: 'ناموفق',
      paymentMethod: 'کارت به کارت',
      totalPrice: 20000,
      currency: 'تومان',
      createdAt: new Date().toISOString(),
      items: [],
    },
  ]);
  assert.equal(stats.noor.metrics.totalRevenue, 50000);
  assert.equal(stats.noor.metrics.totalPaidOrders, 1);

  // 2. gateway-payment-attempt lifecycles
  const createEvent = { params: { data: { status: 'توکن صادر شده' } } };
  attemptLifecycles.beforeCreate(createEvent);
  assert.ok(createEvent.params.data.tokenIssuedAtUtc);
  assert.ok(createEvent.params.data.tokenExpiresAtUtc);
  assert.throws(
    () => attemptLifecycles.beforeUpdateMany({ params: { data: { status: 'توکن صادر شده' } } }),
    /صدور گروهی توکن پرداخت/,
  );

  // 3. order lifecycles syncUserPurchases with Persian orderStatus
  let connectedUserId = null;
  global.strapi = {
    documents: () => ({
      findOne: async () => ({
        id: 1,
        documentId: 'ord-1',
        orderStatus: 'پرداخت شده',
        paymentStatus: 'پرداخت شده',
        user: { id: 77 },
        items: [{ __component: 'order.course-order-item', courseId: 10 }],
      }),
    }),
    db: {
      query: (uid) => ({
        findOne: async () => (uid === 'plugin::users-permissions.user' ? { id: 77, phoneNumber: '' } : null),
        findMany: async () => [{ id: 10, title: 'Course 10', slug: 'course-10', chapters: [] }],
        update: async ({ data }) => {
          connectedUserId = data?.users_permissions_users?.connect?.[0] ?? connectedUserId;
        },
      }),
    },
    service: () => null,
  };
  await orderLifecycles.afterUpdate({ result: { documentId: 'ord-1' } });
  assert.equal(connectedUserId, 77);

  // 4. physicalStockMiddleware late success detection with Persian statuses
  let updatedData = null;
  const mw = physicalStockMiddleware.documentMiddleware({
    db: {
      transaction: async (fn) => fn({ trx: { raw: async () => {} } }),
      query: () => ({
        findMany: async () => [{
          id: 1,
          documentId: 'ord-late',
          orderStatus: 'لغو شده',
          paymentStatus: 'ناموفق',
          stockDeducted: false,
          items: [{ __component: 'order.product-order-item', productId: 5, quantity: 1 }],
        }],
        findOne: async () => ({ id: 5, documentId: 'prod-5' }),
        updateMany: async () => {},
      }),
    },
  });
  // Verify isLateSuccess triggers inside middleware when data has Persian 'پرداخت شده'
  try {
    await mw(
      {
        uid: 'api::order.order',
        action: 'update',
        params: { documentId: 'ord-late', data: { paymentStatus: 'پرداخت شده', orderStatus: 'پرداخت شده' } },
      },
      async () => {
        throw new Error('STOP_AFTER_LATE_CHECK');
      },
    );
  } catch (err) {
    assert.equal(err.message, 'STOP_AFTER_LATE_CHECK');
  }
  // Also test direct context mutation happened before next()
  const ctxCheck = {
    uid: 'api::order.order',
    action: 'update',
    params: { documentId: 'ord-late', data: { paymentStatus: 'پرداخت شده', orderStatus: 'پرداخت شده' } },
  };
  await mw(ctxCheck, async () => {
    updatedData = { ...ctxCheck.params.data };
    return null;
  }).catch(() => {});
  assert.equal(updatedData.orderStatus, 'canceled');
  assert.equal(updatedData.paymentStatus, 'pending_verification');
});

'use strict';

jest.mock('../../src/services/stockReservation', () => ({
  PRODUCT_UID: 'api::product.product',
  lock: jest.fn(async () => {}),
  lockProducts: jest.fn(async () => {}),
  reserve: jest.fn(async () => ({ expires_at: '2026-11-01T10:30:00.000Z' })),
  transition: jest.fn(async () => {}),
  conflict: (message) => { throw Object.assign(new Error(message), { status: 409 }); },
  lineFailure: jest.fn(),
}));
jest.mock('../../src/services/physicalCartQuote', () => ({
  selection: (input) => input.items,
  buyerProfile: async () => ({ documentId: 'buyer' }),
  addressOf: () => ({ addressSnapshot: { city: 'قم' }, addressVersion: 'v1' }),
  quote: async (_strapi, input, items, _buyer, address) => ({
    cartId: input.cartId, buyerExternalUserId: 'buyer', couponCode: input.couponCode || null,
    items: items.map((item) => ({ ...item, unitPriceInNoor: 10 })),
    addressSnapshot: address.addressSnapshot, addressVersion: address.addressVersion, priceInNoor: 30,
  }),
  assertAvailable: jest.fn(),
  invalid: (message) => { throw Object.assign(new Error(message), { status: 400 }); },
}));
jest.mock('../../src/services/byeMoneyPurchaseService', () => ({
  confirmPurchase: jest.fn(async () => ({ httpStatus: 200, response: {} })),
}));

const stock = require('../../src/services/stockReservation');
const { confirmPurchase } = require('../../src/services/byeMoneyPurchaseService');
const service = require('../../src/services/byeMoneyCartService');
const controller = require('../../src/api/byemoney-cart/controllers/byemoney-cart');

const CART = '11111111-1111-4111-8111-111111111111';
const PURCHASES = ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
const items = [
  { externalId: 'course-1', type: 'course', quantity: 1 },
  { externalId: 'chapter-1', type: 'course_chapter', quantity: 1, parentExternalId: 'course-2' },
  { externalId: 'product-1', type: 'product', quantity: 2 },
];
const input = { cartId: CART, buyerExternalUserId: 'buyer', items, couponCode: 'ten' };
const buyerInput = { cartId: CART, buyerExternalUserId: 'buyer' };
const actions = (name) => stock.transition.mock.calls.filter(([, , , action]) => action === name);

function fixture() {
  const carts = [];
  const coupon = { id: 1, usedCount: 0 };
  const orderTouch = jest.fn(() => { throw new Error('رکورد order نباید ساخته یا خوانده شود.'); });
  const strapi = {
    db: {
      metadata: { get: () => ({ tableName: 'coupons', attributes: { code: { columnName: 'code' } } }) },
      transaction: async (callback) => callback({ trx: Object.assign(() => ({
        whereRaw: () => ({ orderBy: () => ({ forUpdate: () => ({ select: async () => [] }) }) }),
      }), { raw: async () => {} }) }),
      query: (uid) => {
        if (uid === 'api::byemoney-cart.byemoney-cart') {
          return {
            findOne: async ({ where }) => carts.find((cart) => cart.cartId === where.cartId) || null,
            create: async ({ data }) => { carts.push({ id: carts.length + 1, ...data }); },
            update: async ({ where, data }) => Object.assign(carts.find((cart) => cart.id === where.id), data),
          };
        }
        if (uid === 'api::coupon.coupon') {
          return { findOne: async () => coupon, update: async ({ data }) => Object.assign(coupon, data) };
        }
        return orderTouch(uid);
      },
    },
    documents: (uid) => ({ create: () => orderTouch(uid), findOne: () => orderTouch(uid) }),
    service: () => ({ consumeCoupon: async () => { coupon.usedCount += 1; return { success: true }; } }),
  };
  return { strapi, carts, coupon, orderTouch };
}

beforeEach(() => jest.clearAllMocks());

describe('خرید جدید بدون رکورد order موازی', () => {
  test('prepare و commit برای دوره، فصل و کالا هیچ order نمی‌سازند و موجودی را یک بار رزرو می‌کنند', async () => {
    const { strapi, carts, coupon, orderTouch } = fixture();
    const prepared = await service.prepare(strapi, input);
    expect(prepared.contractVersion).toBe('physical-v1');
    expect(stock.reserve).toHaveBeenCalledTimes(1);
    expect(coupon.usedCount).toBe(1);

    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await service.transition(strapi, { ...buyerInput, purchaseIds: PURCHASES }, 'commit');
      expect(result).toEqual({ success: true });
    }
    expect(carts[0]).toMatchObject({ state: 'committed', purchaseIds: PURCHASES });
    expect(carts[0].orderDocumentId).toBeUndefined();
    expect(actions('commit')).toHaveLength(1);
    expect(stock.reserve).toHaveBeenCalledTimes(1);
    expect(confirmPurchase).toHaveBeenCalledTimes(2);
    expect(coupon.usedCount).toBe(1);
    expect(orderTouch).not.toHaveBeenCalled();
  });

  test('release کوپن و موجودی را فقط یک بار برمی‌گرداند و پس از commit مجاز نیست', async () => {
    const { strapi, coupon, orderTouch } = fixture();
    await service.prepare(strapi, input);
    await service.transition(strapi, buyerInput, 'release');
    await service.transition(strapi, buyerInput, 'release');
    expect(coupon.usedCount).toBe(0);
    expect(actions('release')).toHaveLength(1);

    const other = fixture();
    await service.prepare(other.strapi, input);
    await service.transition(other.strapi, { ...buyerInput, purchaseIds: PURCHASES }, 'commit');
    await expect(service.transition(other.strapi, buyerInput, 'release')).rejects.toMatchObject({ status: 409 });
    expect(other.coupon.usedCount).toBe(1);
    expect(orderTouch).not.toHaveBeenCalled();
  });

  test('تکرار commit سبد قدیمی همان orderDocumentId ثبت‌شده را برمی‌گرداند', async () => {
    const { strapi, carts } = fixture();
    await service.prepare(strapi, input);
    await service.transition(strapi, { ...buyerInput, purchaseIds: PURCHASES }, 'commit');
    carts[0].orderDocumentId = 'legacy-order';
    const replay = await service.transition(strapi, { ...buyerInput, purchaseIds: PURCHASES }, 'commit');
    expect(replay).toEqual({ success: true, orderDocumentId: 'legacy-order' });
  });
});

describe('GET آدرس رزرو برای ادمین', () => {
  const snapshot = { items: [], addressSnapshot: { city: 'قم', fullAddress: 'نسخهٔ زمان خرید' }, addressVersion: 'v1' };
  function context({ params = { cartId: CART }, state = { user: { role: { type: 'administrator' } } }, cart } = {}) {
    const query = { findOne: jest.fn(async () => cart), create: jest.fn(), update: jest.fn(), delete: jest.fn() };
    global.strapi = { db: { query: jest.fn(() => query), transaction: jest.fn() } };
    const ctx = {
      params, state, set: jest.fn(),
      forbidden: (message) => { ctx.status = 403; ctx.body = message; },
      badRequest: (message) => { ctx.status = 400; ctx.body = message; },
      notFound: (message) => { ctx.status = 404; ctx.body = message; },
    };
    return { ctx, query };
  }
  afterAll(() => { delete global.strapi; });

  test('ادمین نسخهٔ ثابت را می‌گیرد و هیچ نوشتنی رخ نمی‌دهد', async () => {
    const { ctx, query } = context({ cart: { cartId: CART, state: 'committed', snapshot } });
    await controller.address(ctx);
    expect(ctx.body).toEqual({ cartId: CART, addressSnapshot: snapshot.addressSnapshot, addressVersion: 'v1' });
    expect(query.create).not.toHaveBeenCalled();
    expect(query.update).not.toHaveBeenCalled();
    expect(query.delete).not.toHaveBeenCalled();
    expect(global.strapi.db.transaction).not.toHaveBeenCalled();
  });

  test('غیرادمین و توکن غیرکامل 403 می‌گیرند', async () => {
    for (const state of [{ user: { role: { type: 'authenticated' } } }, {},
      { auth: { strategy: { name: 'api-token' }, credentials: { type: 'read-only' } } }]) {
      const { ctx, query } = context({ state, cart: { cartId: CART, snapshot } });
      await controller.address(ctx);
      expect(ctx.status).toBe(403);
      expect(query.findOne).not.toHaveBeenCalled();
    }
  });

  test('cartId ناموجود، نامعتبر یا سبد بدون آدرس پاسخ مناسب می‌گیرد', async () => {
    const missing = context({ cart: null });
    await controller.address(missing.ctx);
    expect(missing.ctx.status).toBe(404);
    const noAddress = context({ cart: { cartId: CART, snapshot: { items: [] } } });
    await controller.address(noAddress.ctx);
    expect(noAddress.ctx.status).toBe(404);
    const malformed = context({ params: { cartId: 'abc' } });
    await controller.address(malformed.ctx);
    expect(malformed.ctx.status).toBe(400);
  });
});

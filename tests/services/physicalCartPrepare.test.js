'use strict';

jest.mock('../../src/services/stockReservation', () => {
  const actual = jest.requireActual('../../src/services/stockReservation');
  return {
    ...actual,
    lock: jest.fn(async () => {}),
    lockProducts: jest.fn(async () => {}),
    reserve: jest.fn(async () => ({ expires_at: '2026-11-21T12:00:00.000Z' })),
    available: jest.fn(async () => 5),
  };
});

const stock = require('../../src/services/stockReservation');
const postexQuote = require('../../src/services/postexShippingQuote');
const service = require('../../src/services/physicalCartService');

const CART = '11111111-1111-4111-8111-111111111111';
const SHIPPING_CHANGED = 'قیمت یا مشخصات ارسال سبد تغییر کرده است. دوباره تلاش کنید.';

function buyer() {
  return {
    documentId: 'buyer-1',
    confirmed: true,
    blocked: false,
    is_foreigner: false,
    address: {
      postalCode: '1234567890',
      fullAddress: 'خیابان ساحلی پلاک ۱',
      recipientName: 'مریم',
      recipientPhone: '09120000000',
      cityLink: {
        documentId: 'city-tehran',
        name: 'تهران',
        province: { name: 'تهران' },
      },
    },
  };
}

function product(price = 100) {
  return {
    documentId: 'prod-a',
    title: 'کالا',
    price,
    discountPercent: 0,
    isAvailable: true,
    stock: 5,
    weight: 250,
    boxTypeId: 5,
    isFragile: false,
    shippingOrigin: {
      originId: 'mashhad',
      displayName: 'انبار مشهد',
      city: { externalId: 259, name: 'مشهد' },
    },
  };
}

function strapiFor(record, settings) {
  const carts = [];
  const consumeCoupon = jest.fn(async () => ({ success: true }));
  const strapi = {
    db: {
      transaction: async (callback) => callback({ trx: { raw: async () => {} } }),
      query(uid) {
        if (uid === 'api::byemoney-cart.byemoney-cart') {
          return {
            findOne: async ({ where }) => carts.find((cart) => cart.cartId === where.cartId) || null,
            create: async ({ data }) => {
              carts.push({ id: carts.length + 1, ...data });
              return carts[carts.length - 1];
            },
          };
        }
        if (uid === 'api::shipping-setting.shipping-setting') {
          return { findOne: async () => settings };
        }
        if (uid === 'api::city.city') {
          return { findOne: async () => ({ externalId: 1 }) };
        }
        if (uid === 'plugin::users-permissions.user') {
          return { findOne: async () => buyer() };
        }
        return { findOne: async () => null };
      },
    },
    documents() {
      return { findOne: async () => record };
    },
    service: () => ({ consumeCoupon }),
  };
  return { strapi, carts, consumeCoupon };
}

function input(extra = {}) {
  return {
    cartId: CART,
    buyerExternalUserId: 'buyer-1',
    items: [{ externalId: 'prod-a', type: 'product', quantity: 1 }],
    ...extra,
  };
}

describe('physical prepare shipping quote outside the lock (S1-02)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    postexQuote.resetCityCacheForTests();
    process.env.POSTEX_API_KEY = 'test-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.POSTEX_API_KEY;
  });

  it('stores the quoted shipping amount and does not call Postex again for the same fingerprint', async () => {
    const record = product();
    const { strapi, carts } = strapiFor(record, {
      costMode: 'postex',
      rialPerNoorForShipping: 10000,
    });
    global.fetch = jest.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ total_cost: 250000 }),
    }));

    const first = await service.prepare(strapi, input());
    const second = await service.prepare(strapi, input());

    expect(first.shippingAmountInNoor).toBe(25);
    expect(second).toBe(first);
    expect(carts).toHaveLength(1);
    expect(carts[0].snapshot.shippingAmountInNoor).toBe(25);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(stock.reserve).toHaveBeenCalledTimes(1);
  });

  it('does not reserve or consume a coupon when the fingerprint changes after the quote', async () => {
    const record = product();
    const { strapi, carts, consumeCoupon } = strapiFor(record, {
      costMode: 'postex',
      rialPerNoorForShipping: 10000,
    });
    global.fetch = jest.fn(async () => {
      record.price = 180;
      return {
        ok: true,
        text: async () => JSON.stringify({ total_cost: 250000 }),
      };
    });

    await expect(service.prepare(strapi, input({ couponCode: 'off' }))).rejects.toMatchObject({
      status: 409,
      code: 'CART_CONFLICT',
      message: SHIPPING_CHANGED,
    });
    expect(carts).toHaveLength(0);
    expect(stock.reserve).not.toHaveBeenCalled();
    expect(consumeCoupon).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the fixed-mode path on the stored amount without calling Postex', async () => {
    const record = product();
    const { strapi, carts } = strapiFor(record, {
      costMode: 'fixed',
      fixedAmountInNoor: 40,
      rialPerNoorForShipping: 10000,
    });
    global.fetch = jest.fn(async () => {
      throw new Error('postex should not be called');
    });

    const prepared = await service.prepare(strapi, input());

    expect(prepared.shippingAmountInNoor).toBe(40);
    expect(prepared.shippingRuleLabel).toBe('ارسال ثابت داخلی');
    expect(carts).toHaveLength(1);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(stock.reserve).toHaveBeenCalledTimes(1);
  });
});

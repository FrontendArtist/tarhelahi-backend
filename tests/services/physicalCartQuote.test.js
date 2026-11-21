'use strict';

const { addressOf, quote } = require('../../src/services/physicalCartQuote');
const postexQuote = require('../../src/services/postexShippingQuote');

const MULTIPLE_ORIGINS = 'اقلام فیزیکی سبد باید از یک مبدأ ارسال باشند.';
const MISSING_ORIGIN = 'مبدأ ارسال کالای فیزیکی تعیین نشده است.';
const DEFAULT_RAMSAR = {
  originId: 'ramsar',
  displayName: 'انبار رامسر',
  city: { externalId: 573, name: 'رامسر' },
};

function catalogProduct(documentId, shippingOrigin) {
  return {
    documentId,
    title: `کالای ${documentId}`,
    price: 100,
    discountPercent: 0,
    isAvailable: true,
    stock: 3,
    weight: 250,
    boxTypeId: 5,
    isFragile: false,
    shippingOrigin,
  };
}

function mashhadOrigin() {
  return {
    originId: 'mashhad',
    displayName: 'انبار مشهد',
    city: { externalId: 259, name: 'مشهد' },
  };
}

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

function strapiFor(products, settings) {
  const byId = new Map(products.map((item) => [item.documentId, item]));
  return {
    documents(uid) {
      if (uid !== 'api::product.product') {
        throw new Error(`unexpected documents uid ${uid}`);
      }
      return {
        findOne: async ({ documentId }) => byId.get(documentId) || null,
      };
    },
    db: {
      query(uid) {
        if (uid === 'api::shipping-setting.shipping-setting') {
          return { findOne: async () => settings };
        }
        if (uid === 'api::city.city') {
          return { findOne: async () => ({ externalId: 1 }) };
        }
        if (uid === 'api::shipping-origin.shipping-origin') {
          return { findOne: async () => DEFAULT_RAMSAR };
        }
        return { findOne: async () => null };
      },
      connection() {
        return {
          where() {
            return { first: async () => ({ available_quantity: 3 }) };
          },
        };
      },
    },
  };
}

function settingsFor(costMode) {
  if (costMode === 'postex') {
    return { costMode: 'postex', rialPerNoorForShipping: 10000 };
  }
  return {
    costMode: 'fixed',
    fixedAmountInNoor: 40,
    rialPerNoorForShipping: 10000,
  };
}

async function prepareQuote(products, costMode) {
  const person = buyer();
  const items = products.map((product) => ({
    type: 'product',
    externalId: product.documentId,
    quantity: 1,
  }));
  const address = addressOf(person, items, false);
  return quote(
    strapiFor(products, settingsFor(costMode)),
    { cartId: '11111111-1111-4111-8111-111111111111' },
    items,
    person,
    address,
  );
}

describe('physical cart quote origin (SHIP-FIX-3)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    postexQuote.resetCityCacheForTests();
    delete process.env.POSTEX_API_KEY;
    delete process.env.POSTEX_BASE_URL;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.POSTEX_API_KEY;
    delete process.env.POSTEX_BASE_URL;
  });

  it('conflicts in fixed mode when a product has no origin', async () => {
    await expect(prepareQuote([
      catalogProduct('prod-missing', null),
    ], 'fixed')).rejects.toMatchObject({
      code: 'CART_CONFLICT',
      status: 409,
      message: MISSING_ORIGIN,
    });
  });

  it('conflicts in postex mode when a product has no origin and does not call Postex', async () => {
    process.env.POSTEX_API_KEY = 'test-key';
    global.fetch = jest.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ total_cost: 250000 }),
    }));

    await expect(prepareQuote([
      catalogProduct('prod-missing', null),
    ], 'postex')).rejects.toMatchObject({
      code: 'CART_CONFLICT',
      status: 409,
      message: MISSING_ORIGIN,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns the resolved city external id for a single origin in fixed mode', async () => {
    const result = await prepareQuote([
      catalogProduct('prod-mashhad', mashhadOrigin()),
    ], 'fixed');

    expect(result.shippingOriginId).toBe('mashhad');
    expect(result.shippingOriginLabel).toBe('انبار مشهد');
    expect(result.shippingOriginCityId).toBe(259);
  });

  it('returns the same city id that postex from_city uses', async () => {
    process.env.POSTEX_API_KEY = 'test-key';
    global.fetch = jest.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ total_cost: 250000 }),
    }));

    const result = await prepareQuote([
      catalogProduct('prod-mashhad', mashhadOrigin()),
    ], 'postex');

    expect(result.shippingOriginId).toBe('mashhad');
    expect(result.shippingOriginLabel).toBe('انبار مشهد');
    expect(result.shippingOriginCityId).toBe(259);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.from_city_code).toBe(result.shippingOriginCityId);
  });

  it('keeps each prepare parcel value equal to the real line and ignores the quote amount', async () => {
    process.env.POSTEX_API_KEY = 'test-key';
    global.fetch = jest.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ total_cost: 9_999_999 }),
    }));

    const expensive = { ...catalogProduct('prod-a', mashhadOrigin()), price: 50 };
    const cheap = { ...catalogProduct('prod-b', mashhadOrigin()), price: 30 };
    const person = buyer();
    const items = [
      { type: 'product', externalId: 'prod-a', quantity: 2 },
      { type: 'product', externalId: 'prod-b', quantity: 1 },
    ];
    const result = await quote(
      strapiFor([expensive, cheap], settingsFor('postex')),
      { cartId: '11111111-1111-4111-8111-111111111111' },
      items,
      person,
      addressOf(person, items, false),
    );

    const declared = Object.fromEntries(result.items.map((item) => [
      item.externalId,
      item.parcel.declaredValueIrr,
    ]));
    expect(declared['prod-a']).toBe(50 * 2 * 10000);
    expect(declared['prod-b']).toBe(30 * 10000);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.parcels).toHaveLength(1);
    expect(body.parcels[0].parcel_properties.total_value).toBe(50 * 2 * 10000 + 30 * 10000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('conflicts when physical products use different origins', async () => {
    await expect(prepareQuote([
      catalogProduct('prod-ramsar', {
        originId: 'ramsar',
        displayName: 'رامسر',
        city: { externalId: 573, name: 'رامسر' },
      }),
      catalogProduct('prod-mashhad', mashhadOrigin()),
    ], 'fixed')).rejects.toMatchObject({
      code: 'CART_CONFLICT',
      status: 409,
      message: MULTIPLE_ORIGINS,
    });
  });
});

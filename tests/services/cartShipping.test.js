'use strict';

const cartShipping = require('../../src/services/cartShipping');
const postexQuote = require('../../src/services/postexShippingQuote');

function settingsQuery(settings, cities = []) {
  return {
    db: {
      query(uid) {
        if (uid === 'api::city.city') {
          return {
            findOne: async ({ where } = {}) => cities.find((city) => city.documentId === where?.documentId) || null,
          };
        }
        return { findOne: async () => settings };
      },
    },
  };
}

const product = (price, quantity = 1) => ({
  type: 'product',
  discountedUnitPriceInNoor: price,
  quantity,
});

describe('cartShipping (SHIP-COST-MODE)', () => {
  beforeEach(() => {
    postexQuote.resetCityCacheForTests();
    delete process.env.POSTEX_API_KEY;
  });

  it('returns zero for carts without physical items', async () => {
    const result = await cartShipping.calculate(settingsQuery({}), [{ type: 'course' }], null);
    expect(result).toEqual({ shippingAmountInNoor: 0, shippingRuleLabel: 'بدون ارسال' });
  });

  it('keeps fixed mode and free-shipping threshold', async () => {
    const strapi = settingsQuery({
      costMode: 'fixed',
      fixedAmountInNoor: 40,
      freeShippingThresholdInNoor: 100,
    });
    const free = await cartShipping.calculate(strapi, [product(60), product(50)], { city: 'تهران' });
    expect(free).toEqual({ shippingAmountInNoor: 0, shippingRuleLabel: 'ارسال رایگان' });

    const paid = await cartShipping.calculate(strapi, [product(30)], { city: 'تهران' });
    expect(paid).toEqual({ shippingAmountInNoor: 40, shippingRuleLabel: 'ارسال ثابت داخلی' });
  });

  it('defaults missing costMode to fixed', async () => {
    const strapi = settingsQuery({ fixedAmountInNoor: 25 });
    const result = await cartShipping.calculate(strapi, [product(10)], { city: 'مشهد' });
    expect(result).toEqual({ shippingAmountInNoor: 25, shippingRuleLabel: 'ارسال ثابت داخلی' });
  });

  it('quotes postex total_cost from the linked city row and ceilings to whole Noor', async () => {
    process.env.POSTEX_API_KEY = 'test-key';
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ total_cost: 3342000 }),
    }));

    const strapi = settingsQuery({
      costMode: 'postex',
      rialPerNoorForShipping: 10000,
      freeShippingThresholdInNoor: 1000,
    }, [{ documentId: 'city-tehran', externalId: 100 }]);

    const result = await cartShipping.calculate(
      strapi,
      [product(50)],
      { city: 'تهران', province: 'تهران', cityDocumentId: 'city-tehran' },
      { fetchImpl, fromCityId: 573 },
    );

    expect(result).toEqual({ shippingAmountInNoor: 335, shippingRuleLabel: 'برآورد پستکس' });
    const quoteCall = fetchImpl.mock.calls.find(([url]) => String(url).includes('shipping/quotes'));
    const body = JSON.parse(quoteCall[1].body);
    expect(body.from_city_code).toBe(573);
    expect(body.parcels[0].to_city_code).toBe(100);
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('cities/all'))).toBe(false);
  });

  it('skips postex call when free-shipping threshold is met', async () => {
    process.env.POSTEX_API_KEY = 'test-key';
    const fetchImpl = jest.fn();
    const strapi = settingsQuery({
      costMode: 'postex',
      freeShippingThresholdInNoor: 100,
      rialPerNoorForShipping: 10000,
    });

    const result = await cartShipping.calculate(
      strapi,
      [product(120)],
      { city: 'تهران' },
      { fetchImpl, fromCityId: 259 },
    );

    expect(result).toEqual({ shippingAmountInNoor: 0, shippingRuleLabel: 'ارسال رایگان' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('conflicts when postex mode has no API key', async () => {
    const strapi = settingsQuery({ costMode: 'postex' });
    await expect(
      cartShipping.calculate(strapi, [product(10)], { city: 'تهران' }, { fromCityId: 573 }),
    ).rejects.toMatchObject({ code: 'CART_CONFLICT', status: 409 });
  });

  it('conflicts when postex mode has no fromCityId', async () => {
    process.env.POSTEX_API_KEY = 'test-key';
    const strapi = settingsQuery({ costMode: 'postex' });
    await expect(
      cartShipping.calculate(strapi, [product(10)], { city: 'تهران' }),
    ).rejects.toMatchObject({ code: 'CART_CONFLICT', status: 409 });
  });

  it('conflicts when the snapshot has no city in our table', async () => {
    process.env.POSTEX_API_KEY = 'test-key';
    const strapi = settingsQuery({ costMode: 'postex', rialPerNoorForShipping: 10000 });
    await expect(
      cartShipping.calculate(
        strapi,
        [product(10)],
        { city: 'تهران', province: 'تهران', cityDocumentId: 'missing' },
        { fromCityId: 573 },
      ),
    ).rejects.toMatchObject({ code: 'CART_CONFLICT', status: 409 });
  });

  it('conflicts when postex quote fails', async () => {
    process.env.POSTEX_API_KEY = 'test-key';
    const fetchImpl = jest.fn(async () => ({
      ok: false,
      text: async () => JSON.stringify({ message: 'قطع موقت' }),
    }));
    const strapi = settingsQuery(
      { costMode: 'postex', rialPerNoorForShipping: 10000 },
      [{ documentId: 'city-mashhad', externalId: 259 }],
    );

    await expect(
      cartShipping.calculate(
        strapi,
        [product(10)],
        { city: 'مشهد', province: 'خراسان رضوی', cityDocumentId: 'city-mashhad' },
        { fetchImpl, fromCityId: 573 },
      ),
    ).rejects.toMatchObject({ code: 'CART_CONFLICT', status: 409 });
  });
});


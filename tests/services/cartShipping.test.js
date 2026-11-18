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

const product = (price, quantity = 1, parcelFactors = {
  weightGrams: 250,
  lengthCm: 15,
  widthCm: 10,
  heightCm: 20,
  boxTypeId: 5,
  isFragile: false,
}) => ({
  type: 'product',
  externalId: `p-${price}-${quantity}`,
  discountedUnitPriceInNoor: price,
  quantity,
  parcelFactors,
});

describe('cartShipping (SHIP-BOX-TYPE)', () => {
  beforeEach(() => {
    postexQuote.resetCityCacheForTests();
    delete process.env.POSTEX_API_KEY;
  });

  it('returns zero for carts without physical items', async () => {
    const result = await cartShipping.calculate(settingsQuery({}), [{ type: 'course' }], null);
    expect(result).toEqual({ shippingAmountInNoor: 0, shippingRuleLabel: 'بدون ارسال', parcelQuotes: [] });
  });

  it('keeps fixed mode and free-shipping threshold', async () => {
    const strapi = settingsQuery({
      costMode: 'fixed',
      fixedAmountInNoor: 40,
      freeShippingThresholdInNoor: 100,
      rialPerNoorForShipping: 10000,
    });
    const free = await cartShipping.calculate(strapi, [product(60), product(50)], { city: 'تهران' });
    expect(free.shippingAmountInNoor).toBe(0);
    expect(free.shippingRuleLabel).toBe('ارسال رایگان');
    expect(free.parcelQuotes).toHaveLength(2);

    const paid = await cartShipping.calculate(strapi, [product(30)], { city: 'تهران' });
    expect(paid).toMatchObject({ shippingAmountInNoor: 40, shippingRuleLabel: 'ارسال ثابت داخلی' });
    expect(paid.parcelQuotes[0].declaredValueIrr).toBe(30 * 10000);
  });

  it('defaults missing costMode to fixed', async () => {
    const strapi = settingsQuery({ fixedAmountInNoor: 25, rialPerNoorForShipping: 10000 });
    const result = await cartShipping.calculate(strapi, [product(10)], { city: 'مشهد' });
    expect(result.shippingAmountInNoor).toBe(25);
    expect(result.shippingRuleLabel).toBe('ارسال ثابت داخلی');
  });

  it('quotes each physical item and sums total_cost', async () => {
    process.env.POSTEX_API_KEY = 'test-key';
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ total_cost: 1_000_000 }),
    }));

    const strapi = settingsQuery({
      costMode: 'postex',
      rialPerNoorForShipping: 10000,
      freeShippingThresholdInNoor: 1000,
    }, [{ documentId: 'city-tehran', externalId: 100 }]);

    const items = [
      product(50, 2, {
        weightGrams: 500,
        lengthCm: 20,
        widthCm: 15,
        heightCm: 20,
        boxTypeId: 6,
        isFragile: true,
      }),
      product(30, 1, {
        weightGrams: 100,
        lengthCm: 10,
        widthCm: 10,
        heightCm: 15,
        boxTypeId: 4,
        isFragile: false,
      }),
    ];

    const result = await cartShipping.calculate(
      strapi,
      items,
      { city: 'تهران', province: 'تهران', cityDocumentId: 'city-tehran' },
      { fetchImpl, fromCityId: 573 },
    );

    expect(result).toMatchObject({ shippingAmountInNoor: 200, shippingRuleLabel: 'برآورد پستکس' });
    expect(result.parcelQuotes).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(firstBody.parcels[0].parcel_properties).toMatchObject({
      box_type_id: 6,
      total_weight: 500,
      length: 20,
      width: 15,
      height: 20,
      total_value: 1_000_000,
      is_fragile: true,
    });
    expect(firstBody.from_city_code).toBe(573);
    expect(firstBody.parcels[0].to_city_code).toBe(100);
  });

  it('rejects postex cart when box type is missing', async () => {
    process.env.POSTEX_API_KEY = 'test-key';
    const strapi = settingsQuery({ costMode: 'postex', rialPerNoorForShipping: 10000 });
    await expect(
      cartShipping.calculate(
        strapi,
        [product(10, 1, null)],
        { city: 'تهران', cityDocumentId: 'city-tehran' },
        { fromCityId: 573 },
      ),
    ).rejects.toMatchObject({
      code: 'CART_CONFLICT',
      status: 409,
      message: 'جعبهٔ کالا تعیین نشده',
    });
  });

  it('retries with value floor only after postex rejects lower value', async () => {
    process.env.POSTEX_API_KEY = 'test-key';
    let calls = 0;
    const fetchImpl = jest.fn(async (_url, init) => {
      calls += 1;
      const body = JSON.parse(init.body);
      const value = body.parcels[0].parcel_properties.total_value;
      if (value < postexQuote.VALUE_FLOOR_IRR) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({
            title: 'One or more validation errors occurred.',
            errors: { 'Parcels[0].ParcelProperties.TotalValue': ['minimum value is 50000000'] },
          }),
        };
      }
      return { ok: true, text: async () => JSON.stringify({ total_cost: 2_000_000 }) };
    });

    const strapi = settingsQuery({
      costMode: 'postex',
      rialPerNoorForShipping: 10000,
    }, [{ documentId: 'city-tehran', externalId: 100 }]);

    const result = await cartShipping.calculate(
      strapi,
      [product(10, 1)],
      { city: 'تهران', cityDocumentId: 'city-tehran' },
      { fetchImpl, fromCityId: 573 },
    );

    expect(calls).toBe(2);
    expect(result.shippingAmountInNoor).toBe(200);
    expect(result.parcelQuotes[0].declaredValueIrr).toBe(postexQuote.VALUE_FLOOR_IRR);
  });

  it('skips postex call when free-shipping threshold is met but still returns factors', async () => {
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

    expect(result.shippingAmountInNoor).toBe(0);
    expect(result.shippingRuleLabel).toBe('ارسال رایگان');
    expect(result.parcelQuotes[0].declaredValueIrr).toBe(1_200_000);
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

  it('surfaces postex field validation details', async () => {
    process.env.POSTEX_API_KEY = 'test-key';
    const fetchImpl = jest.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({
        title: 'One or more validation errors occurred.',
        errors: { 'Parcels[0].ParcelProperties.Length': ['The Length field is required.'] },
      }),
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
    ).rejects.toMatchObject({
      code: 'CART_CONFLICT',
      status: 409,
      message: expect.stringContaining('Length'),
    });
  });

  it('reads product weight times quantity and box dimensions', () => {
    const factors = cartShipping.readParcelFactors(
      { weight: 125.4, boxTypeId: 'box5: جعبه سایز 2 (15×10×20)', isFragile: true },
      2,
    );
    expect(factors).toEqual({
      weightGrams: 251,
      lengthCm: 15,
      widthCm: 10,
      heightCm: 20,
      boxTypeId: 5,
      isFragile: true,
    });
    expect(cartShipping.readParcelFactors({ weight: 10 }, 1)).toBeNull();
    expect(() => cartShipping.requireProductParcelOrConflict({ weight: 10 }, 1))
      .toThrow('جعبهٔ کالا تعیین نشده');
  });
});

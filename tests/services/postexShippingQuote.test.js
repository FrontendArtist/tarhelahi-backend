'use strict';

const postexQuote = require('../../src/services/postexShippingQuote');

const parcel = {
  weightGrams: 250,
  lengthCm: 15,
  widthCm: 10,
  heightCm: 20,
  boxTypeId: 5,
  parcelValueIrr: 100_000,
  isFragile: false,
};

describe('postexShippingQuote', () => {
  beforeEach(() => {
    postexQuote.resetCityCacheForTests();
  });

  it('resolves city id with normalized Persian letters', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => [{ cities: [{ id: 573, name: 'رامسر' }, { id: 259, name: 'مشهد' }] }],
    }));

    const id = await postexQuote.resolveCityId('رامسر', 'مازندران', {
      apiKey: 'k',
      baseUrl: 'https://api.postex.ir',
      fetchImpl,
    });
    expect(id).toBe(573);
  });

  it('posts quotes body with box_type_id and returns total_cost', async () => {
    const fetchImpl = jest.fn(async (url, init) => {
      if (String(url).includes('cities/all')) {
        return {
          ok: true,
          json: async () => [{ cities: [{ id: 1, name: 'تهران' }] }],
        };
      }
      expect(init.method).toBe('POST');
      expect(init.headers['x-api-key']).toBe('secret');
      const body = JSON.parse(init.body);
      expect(body.from_city_code).toBe(postexQuote.DEFAULT_FROM_CITY_ID);
      expect(body.courier.courier_code).toBe(postexQuote.DEFAULT_COURIER);
      expect(body.parcels[0].to_city_code).toBe(1);
      expect(body.parcels[0].parcel_properties).toMatchObject({
        box_type_id: 5,
        total_weight: 250,
        length: 15,
        width: 10,
        height: 20,
        total_value: 100_000,
        is_fragile: false,
      });
      return {
        ok: true,
        text: async () => JSON.stringify({ total_cost: 2_000_000 }),
      };
    });

    const total = await postexQuote.quoteTotalCostIrr(
      { cityName: 'تهران', provinceName: 'تهران', ...parcel },
      { apiKey: 'secret', fetchImpl },
    );
    expect(total).toBe(2_000_000);
  });

  it('extracts validation field details from postex errors', () => {
    const message = postexQuote.extractErrorMessage({
      title: 'One or more validation errors occurred.',
      errors: { 'Parcels[0].ParcelItems': ['is required'] },
    }, 400);
    expect(message).toContain('ParcelItems');
    expect(message).toContain('One or more validation errors occurred.');
  });

  it('retries with value floor when lower value is rejected', async () => {
    const fetchImpl = jest.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      const value = body.parcels[0].parcel_properties.total_value;
      if (value < postexQuote.VALUE_FLOOR_IRR) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ message: 'value too low' }),
        };
      }
      return { ok: true, text: async () => JSON.stringify({ total_cost: 3_000_000 }) };
    });

    const result = await postexQuote.quoteParcelCostIrr(
      { toCityCode: 1, ...parcel, parcelValueIrr: 100_000 },
      { apiKey: 'secret', fetchImpl, fromCityId: 573 },
    );
    expect(result).toEqual({
      totalIrr: 3_000_000,
      declaredValueIrr: postexQuote.VALUE_FLOOR_IRR,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

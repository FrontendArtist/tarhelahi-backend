'use strict';

const postexQuote = require('../../src/services/postexShippingQuote');

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

  it('posts quotes body and returns total_cost', async () => {
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
      return {
        ok: true,
        text: async () => JSON.stringify({ total_cost: 2_000_000 }),
      };
    });

    const total = await postexQuote.quoteTotalCostIrr(
      { cityName: 'تهران', provinceName: 'تهران' },
      { apiKey: 'secret', fetchImpl },
    );
    expect(total).toBe(2_000_000);
  });
});

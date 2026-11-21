'use strict';

const { createHash } = require('node:crypto');
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

  it('does not resend a rejected quote and keeps the declared value', async () => {
    const declared = 100_000;
    const fetchImpl = jest.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      expect(body.parcels[0].parcel_properties.total_value).toBe(declared);
      return {
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ message: 'value too low' }),
      };
    });

    await expect(
      postexQuote.quoteParcelCostIrr(
        { toCityCode: 1, ...parcel, parcelValueIrr: declared },
        { apiKey: 'secret', fetchImpl, fromCityId: 573 },
      ),
    ).rejects.toThrow('value too low');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('postex config fingerprint (S5-04)', () => {
  const previousKey = process.env.POSTEX_API_KEY;
  const previousUrl = process.env.POSTEX_BASE_URL;

  afterEach(() => {
    if (previousKey === undefined) {
      delete process.env.POSTEX_API_KEY;
    } else {
      process.env.POSTEX_API_KEY = previousKey;
    }
    if (previousUrl === undefined) {
      delete process.env.POSTEX_BASE_URL;
    } else {
      process.env.POSTEX_BASE_URL = previousUrl;
    }
  });

  it('logs only the sha256 hex of normalized base url and key', () => {
    const info = jest.fn();
    const warn = jest.fn();
    const apiKey = 'super-secret-postex-key';
    const fingerprint = postexQuote.logConfigFingerprint(
      { log: { info, warn } },
      { apiKey, baseUrl: 'https://api.postex.ir///' },
    );
    const expected = createHash('sha256')
      .update(`https://api.postex.ir|${apiKey}`)
      .digest('hex');

    expect(fingerprint).toBe(expected);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(`[Postex] config fingerprint: ${expected}`);
    expect(warn).not.toHaveBeenCalled();
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain(apiKey);
    expect(logged).not.toContain('api.postex.ir');
  });

  it('reads env at startup and still omits the raw key', () => {
    process.env.POSTEX_API_KEY = 'env-only-secret';
    process.env.POSTEX_BASE_URL = 'https://example.test/postex/';
    const info = jest.fn();
    const warn = jest.fn();

    postexQuote.logConfigFingerprint({ log: { info, warn } });

    const expected = createHash('sha256')
      .update('https://example.test/postex|env-only-secret')
      .digest('hex');
    expect(info).toHaveBeenCalledWith(`[Postex] config fingerprint: ${expected}`);
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain('env-only-secret');
    expect(logged).not.toContain('example.test');
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs that the key is not configured when the key is empty', () => {
    const info = jest.fn();
    const warn = jest.fn();

    const fingerprint = postexQuote.logConfigFingerprint(
      { log: { info, warn } },
      { apiKey: '   ', baseUrl: 'https://api.postex.ir/' },
    );

    expect(fingerprint).toBeNull();
    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[Postex] API key is not configured.');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('api.postex.ir');
  });
});

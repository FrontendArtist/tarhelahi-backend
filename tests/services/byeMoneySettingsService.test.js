'use strict';

const {
  fetchRateFromDatabase,
  fetchRateFromApi,
  getRialToNoorRate,
  syncShippingSettingRate,
  clearCache,
  closePool,
} = require('../../src/services/byeMoneySettingsService');

describe('byeMoneySettingsService', () => {
  beforeEach(() => {
    clearCache();
    delete process.env.BYEMONEY_API_URL;
  });

  afterAll(async () => {
    await closePool();
  });

  describe('fetchRateFromDatabase', () => {
    it('returns the parsed integer rate from SystemSettings table', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({
          rows: [{ Value: '10' }],
        }),
      };

      const rate = await fetchRateFromDatabase({ pool: mockPool });
      expect(rate).toBe(10);
      expect(mockPool.query).toHaveBeenCalledWith(
        'SELECT "Value" FROM "SystemSettings" WHERE "Key" = $1 LIMIT 1',
        ['ConversionRate:RialToNoor'],
      );
    });

    it('returns null when no rows match', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
      };

      const rate = await fetchRateFromDatabase({ pool: mockPool });
      expect(rate).toBeNull();
    });

    it('returns null when rate is invalid or not positive', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({ rows: [{ Value: '-5' }] }),
      };

      const rate = await fetchRateFromDatabase({ pool: mockPool });
      expect(rate).toBeNull();
    });
  });

  describe('fetchRateFromApi', () => {
    it('returns conversion rate from ByeMoney API', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ rialPerNoor: 15000, tomanPerNoor: 1500 }),
      });
      global.fetch = mockFetch;

      const rate = await fetchRateFromApi({ apiUrl: 'http://test-byemoney:5000' });
      expect(rate).toBe(15000);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-byemoney:5000/api/settings/conversion-rate',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('returns null if response is not ok', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
      const rate = await fetchRateFromApi({ apiUrl: 'http://test-byemoney:5000' });
      expect(rate).toBeNull();
    });
  });

  describe('getRialToNoorRate', () => {
    it('uses cache on subsequent calls within TTL', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({ rows: [{ Value: '12000' }] }),
      };

      const first = await getRialToNoorRate({ pool: mockPool });
      expect(first).toBe(12000);
      expect(mockPool.query).toHaveBeenCalledTimes(1);

      const second = await getRialToNoorRate({ pool: mockPool });
      expect(second).toBe(12000);
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    it('bypasses cache when forceFresh is true', async () => {
      const mockPool = {
        query: jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ Value: '10000' }] })
          .mockResolvedValueOnce({ rows: [{ Value: '20000' }] }),
      };

      const first = await getRialToNoorRate({ pool: mockPool });
      expect(first).toBe(10000);

      const second = await getRialToNoorRate({ pool: mockPool, forceFresh: true });
      expect(second).toBe(20000);
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it('falls back to API if database query throws error', async () => {
      const mockPool = {
        query: jest.fn().mockRejectedValue(new Error('Connection failed')),
      };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ rialPerNoor: 25000 }),
      });

      const rate = await getRialToNoorRate({
        pool: mockPool,
        apiUrl: 'http://localhost:5000',
        forceFresh: true,
      });
      expect(rate).toBe(25000);
    });
  });

  describe('syncShippingSettingRate', () => {
    it('updates existing shipping-setting if rate differs', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({ rows: [{ Value: '10000' }] }),
      };
      const updateMock = jest.fn().mockResolvedValue({});
      const strapiMock = {
        db: {
          query: () => ({
            findOne: jest.fn().mockResolvedValue({ id: 1, rialPerNoorForShipping: '5000' }),
            update: updateMock,
          }),
        },
      };

      await syncShippingSettingRate(strapiMock, { pool: mockPool, forceFresh: true });
      expect(updateMock).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { rialPerNoorForShipping: '10000' },
      });
    });

    it('does not update if rate is already identical', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({ rows: [{ Value: '10000' }] }),
      };
      const updateMock = jest.fn().mockResolvedValue({});
      const strapiMock = {
        db: {
          query: () => ({
            findOne: jest.fn().mockResolvedValue({ id: 1, rialPerNoorForShipping: '10000' }),
            update: updateMock,
          }),
        },
      };

      await syncShippingSettingRate(strapiMock, { pool: mockPool, forceFresh: true });
      expect(updateMock).not.toHaveBeenCalled();
    });

    it('creates shipping-setting if none exists', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({ rows: [{ Value: '10000' }] }),
      };
      const createMock = jest.fn().mockResolvedValue({});
      const strapiMock = {
        db: {
          query: () => ({
            findOne: jest.fn().mockResolvedValue(null),
            create: createMock,
          }),
        },
      };

      await syncShippingSettingRate(strapiMock, { pool: mockPool, forceFresh: true });
      expect(createMock).toHaveBeenCalledWith({
        data: {
          costMode: 'fixed',
          rialPerNoorForShipping: '10000',
        },
      });
    });
  });
});

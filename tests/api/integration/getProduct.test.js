'use strict';

const integrationController = require('../../../src/api/integration/controllers/integration');
const isServiceAuthenticatedPolicy = require('../../../src/policies/is-service-authenticated');

describe('ByeMoney Integration - getProduct Endpoint', () => {
  let mockStrapi;
  let mockProductQuery;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, BYEMONEY_SERVICE_KEY: 'test-secret-key-123' };

    mockProductQuery = {
      findOne: jest.fn(),
    };

    mockStrapi = {
      db: {
        query: jest.fn((model) => {
          if (model === 'api::product.product') {
            return mockProductQuery;
          }
          throw new Error(`Unexpected query model: ${model}`);
        }),
      },
      log: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    };

    global.strapi = mockStrapi;
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete global.strapi;
    process.env = originalEnv;
  });

  describe('Validation & Error Handling', () => {
    it('should return 400 when externalId is missing or empty', async () => {
      const ctx = {
        params: { externalId: '' },
        badRequest: jest.fn((msg) => ({ status: 400, message: msg })),
        notFound: jest.fn(),
        send: jest.fn(),
      };

      const res = await integrationController.getProduct(ctx);
      expect(ctx.badRequest).toHaveBeenCalledWith('externalId is required');
      expect(res).toEqual({ status: 400, message: 'externalId is required' });
    });

    it('should return 404 when product is not found in database', async () => {
      mockProductQuery.findOne.mockResolvedValue(null);

      const ctx = {
        params: { externalId: 'prod-doc-non-existent' },
        badRequest: jest.fn(),
        notFound: jest.fn((msg) => ({ status: 404, message: msg })),
        send: jest.fn(),
      };

      const res = await integrationController.getProduct(ctx);
      expect(ctx.notFound).toHaveBeenCalledWith('Product not found');
      expect(res).toEqual({ status: 404, message: 'Product not found' });
    });
  });

  describe('Success & DTO Whitelist Contract', () => {
    it('should return correct DTO when published in-stock product is found', async () => {
      const mockProduct = {
        id: 5,
        documentId: 'prod-doc-123',
        title: 'Tarh Elahi Book',
        slug: 'tarh-elahi-book',
        price: 1800000,
        stock: 35,
        isAvailable: true,
        publishedAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-15T10:00:00.000Z',
      };

      mockProductQuery.findOne.mockResolvedValueOnce(mockProduct);

      const ctx = {
        params: { externalId: 'prod-doc-123' },
        badRequest: jest.fn(),
        notFound: jest.fn(),
        send: jest.fn((data) => data),
      };

      const res = await integrationController.getProduct(ctx);

      expect(ctx.send).toHaveBeenCalled();
      expect(res).toEqual({
        source: 'tarh_elahi',
        type: 'product',
        externalId: 'prod-doc-123',
        parentExternalId: null,
        title: 'Tarh Elahi Book',
        slug: 'tarh-elahi-book',
        priceRial: 1800000,
        stock: 35,
        published: true,
        available: true,
        updatedAt: '2026-09-15T10:00:00.000Z',
      });

      // Strict contract: no leakage of internal DB id
      expect(res.id).toBeUndefined();
    });

    it('should mark available as false when stock is 0', async () => {
      const mockProduct = {
        id: 6,
        documentId: 'prod-doc-out-of-stock',
        title: 'Sold Out Item',
        slug: 'sold-out-item',
        price: 250000,
        stock: 0,
        isAvailable: true,
        publishedAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-15T10:00:00.000Z',
      };

      mockProductQuery.findOne.mockResolvedValueOnce(mockProduct);

      const ctx = {
        params: { externalId: 'prod-doc-out-of-stock' },
        badRequest: jest.fn(),
        notFound: jest.fn(),
        send: jest.fn((data) => data),
      };

      const res = await integrationController.getProduct(ctx);
      expect(res.published).toBe(true);
      expect(res.available).toBe(false);
      expect(res.stock).toBe(0);
    });

    it('should mark available as false when isAvailable flag is false', async () => {
      const mockProduct = {
        id: 7,
        documentId: 'prod-doc-disabled',
        title: 'Disabled Item',
        slug: 'disabled-item',
        price: 300000,
        stock: 10,
        isAvailable: false,
        publishedAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-15T10:00:00.000Z',
      };

      mockProductQuery.findOne.mockResolvedValueOnce(mockProduct);

      const ctx = {
        params: { externalId: 'prod-doc-disabled' },
        badRequest: jest.fn(),
        notFound: jest.fn(),
        send: jest.fn((data) => data),
      };

      const res = await integrationController.getProduct(ctx);
      expect(res.published).toBe(true);
      expect(res.available).toBe(false);
    });

    it('should fallback to draft product and set published/available to false', async () => {
      // First call for published returns null
      mockProductQuery.findOne.mockResolvedValueOnce(null);
      // Fallback call for draft returns product with publishedAt = null
      mockProductQuery.findOne.mockResolvedValueOnce({
        id: 8,
        documentId: 'prod-doc-draft',
        title: 'Draft Product',
        slug: 'draft-product',
        price: 400000,
        stock: 20,
        isAvailable: true,
        publishedAt: null,
        updatedAt: '2026-09-16T11:00:00.000Z',
      });

      const ctx = {
        params: { externalId: 'prod-doc-draft' },
        badRequest: jest.fn(),
        notFound: jest.fn(),
        send: jest.fn((data) => data),
      };

      const res = await integrationController.getProduct(ctx);
      expect(res.published).toBe(false);
      expect(res.available).toBe(false);
      expect(res.externalId).toBe('prod-doc-draft');
    });
  });

  describe('Service Policy Security (is-service-authenticated)', () => {
    it('should reject request when X-Service-Key header is missing', () => {
      const policyCtx = {
        get: jest.fn(() => null),
      };
      expect(() => isServiceAuthenticatedPolicy(policyCtx)).toThrow('Unauthorized');
    });
  });
});

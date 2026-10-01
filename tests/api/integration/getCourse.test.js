'use strict';

const integrationController = require('../../../src/api/integration/controllers/integration');
const isServiceAuthenticatedPolicy = require('../../../src/policies/is-service-authenticated');

describe('ByeMoney Integration - getCourse Endpoint', () => {
  let mockStrapi;
  let mockCourseQuery;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, BYEMONEY_SERVICE_KEY: 'test-secret-key-123' };

    mockCourseQuery = {
      findOne: jest.fn(),
    };

    mockStrapi = {
      db: {
        query: jest.fn((model) => {
          if (model === 'api::course.course') {
            return mockCourseQuery;
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

      const res = await integrationController.getCourse(ctx);
      expect(ctx.badRequest).toHaveBeenCalledWith('externalId is required');
      expect(res).toEqual({ status: 400, message: 'externalId is required' });
    });

    it('should return 404 when course is not found', async () => {
      mockCourseQuery.findOne.mockResolvedValue(null);

      const ctx = {
        params: { externalId: 'non-existing-doc-id' },
        badRequest: jest.fn(),
        notFound: jest.fn((msg) => ({ status: 404, message: msg })),
        send: jest.fn(),
      };

      const res = await integrationController.getCourse(ctx);
      expect(ctx.notFound).toHaveBeenCalledWith('Course not found');
      expect(res).toEqual({ status: 404, message: 'Course not found' });
    });
  });

  describe('Authoritative DTO & Noor Contract', () => {
    it('should return authoritative course DTO with priceNoor (and no priceRial)', async () => {
      const mockCourse = {
        id: 42,
        documentId: 'course-doc-123',
        title: 'Mastering Antigravity',
        slug: 'mastering-antigravity',
        price: 250,
        publishedAt: '2026-09-20T00:00:00.000Z',
        updatedAt: '2026-09-20T12:00:00.000Z',
      };

      mockCourseQuery.findOne.mockResolvedValueOnce(mockCourse);

      const ctx = {
        params: { externalId: 'course-doc-123' },
        badRequest: jest.fn(),
        notFound: jest.fn(),
        send: jest.fn((data) => data),
      };

      const res = await integrationController.getCourse(ctx);

      expect(ctx.send).toHaveBeenCalled();
      expect(res).toEqual({
        source: 'tarh_elahi',
        type: 'course',
        externalId: 'course-doc-123',
        parentExternalId: null,
        title: 'Mastering Antigravity',
        slug: 'mastering-antigravity',
        priceNoor: 250,
        published: true,
        available: true,
        updatedAt: '2026-09-20T12:00:00.000Z',
      });

      // Verify no priceRial or internal id leaked
      expect(res.priceRial).toBeUndefined();
      expect(res.id).toBeUndefined();
      expect(res._id).toBeUndefined();
    });

    it('should return priceNoor: 0 for free courses', async () => {
      const mockFreeCourse = {
        id: 43,
        documentId: 'course-free-123',
        title: 'Free Introductory Course',
        slug: 'free-intro',
        price: 0,
        publishedAt: '2026-09-20T00:00:00.000Z',
        updatedAt: '2026-09-20T12:00:00.000Z',
      };

      mockCourseQuery.findOne.mockResolvedValueOnce(mockFreeCourse);

      const ctx = {
        params: { externalId: 'course-free-123' },
        badRequest: jest.fn(),
        notFound: jest.fn(),
        send: jest.fn((data) => data),
      };

      const res = await integrationController.getCourse(ctx);
      expect(res.priceNoor).toBe(0);
      expect(res.priceRial).toBeUndefined();
    });
  });
});

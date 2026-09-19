'use strict';

const integrationController = require('../../../src/api/integration/controllers/integration');
const isServiceAuthenticatedPolicy = require('../../../src/policies/is-service-authenticated');

describe('ByeMoney Integration - getChapter Endpoint', () => {
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
        params: { externalId: '   ' },
        badRequest: jest.fn((msg) => ({ status: 400, message: msg })),
        notFound: jest.fn(),
        send: jest.fn(),
      };

      const res = await integrationController.getChapter(ctx);
      expect(ctx.badRequest).toHaveBeenCalledWith('externalId is required');
      expect(res).toEqual({ status: 400, message: 'externalId is required' });
    });

    it('should return 404 when chapter or parent course is not found', async () => {
      mockCourseQuery.findOne.mockResolvedValue(null);

      const ctx = {
        params: { externalId: 'ch-uuid-999' },
        badRequest: jest.fn(),
        notFound: jest.fn((msg) => ({ status: 404, message: msg })),
        send: jest.fn(),
      };

      const res = await integrationController.getChapter(ctx);
      expect(ctx.notFound).toHaveBeenCalledWith('Chapter not found');
      expect(res).toEqual({ status: 404, message: 'Chapter not found' });
    });

    it('should return 404 when course is found but chapters list does not contain externalId', async () => {
      mockCourseQuery.findOne.mockResolvedValueOnce({
        id: 1,
        documentId: 'course-doc-123',
        publishedAt: '2026-09-01T00:00:00.000Z',
        chapters: [
          { integrationId: 'other-chapter-uuid', title: 'Chapter Other', price: 1000 },
        ],
      });

      const ctx = {
        params: { externalId: 'ch-uuid-target' },
        badRequest: jest.fn(),
        notFound: jest.fn((msg) => ({ status: 404, message: msg })),
        send: jest.fn(),
      };

      const res = await integrationController.getChapter(ctx);
      expect(ctx.notFound).toHaveBeenCalledWith('Chapter not found');
      expect(res).toEqual({ status: 404, message: 'Chapter not found' });
    });
  });

  describe('Success & DTO Whitelist Contract', () => {
    it('should return correct DTO when chapter is found in a published course', async () => {
      const mockCourse = {
        id: 10,
        documentId: 'course-doc-abc',
        title: 'Mastering Architecture',
        slug: 'mastering-architecture',
        publishedAt: '2026-09-01T00:00:00.000Z',
        isChaptered: true,
        updatedAt: '2026-09-15T12:00:00.000Z',
        chapters: [
          {
            id: 101,
            integrationId: 'chapter-uuid-1',
            title: 'Part 1: Foundations',
            price: 500000,
            duration: '01:30',
          },
          {
            id: 102,
            integrationId: 'chapter-uuid-2',
            title: 'Part 2: Advanced Concepts',
            price: 750000,
            duration: '02:15',
          },
        ],
      };

      mockCourseQuery.findOne.mockResolvedValueOnce(mockCourse);

      const ctx = {
        params: { externalId: 'chapter-uuid-2' },
        badRequest: jest.fn(),
        notFound: jest.fn(),
        send: jest.fn((data) => data),
      };

      const res = await integrationController.getChapter(ctx);

      expect(ctx.send).toHaveBeenCalled();
      expect(res).toEqual({
        source: 'tarh_elahi',
        type: 'course_chapter',
        externalId: 'chapter-uuid-2',
        parentExternalId: 'course-doc-abc',
        title: 'Part 2: Advanced Concepts',
        slug: 'mastering-architecture-chapter-2',
        priceRial: 750000,
        duration: '02:15',
        published: true,
        available: true,
        updatedAt: '2026-09-15T12:00:00.000Z',
      });

      // Strict contract: verify no sensitive or internal properties leaked
      expect(res.id).toBeUndefined();
      expect(res._id).toBeUndefined();
    });

    it('should accurately reflect unavailable status if parent course isChaptered is false', async () => {
      const mockCourse = {
        id: 11,
        documentId: 'course-doc-xyz',
        title: 'Single Bundle Course',
        slug: 'single-bundle',
        publishedAt: '2026-09-01T00:00:00.000Z',
        isChaptered: false,
        updatedAt: '2026-09-15T12:00:00.000Z',
        chapters: [
          {
            integrationId: 'chapter-uuid-xyz',
            title: 'Chapter 1',
            price: 300000,
          },
        ],
      };

      mockCourseQuery.findOne.mockResolvedValueOnce(mockCourse);

      const ctx = {
        params: { externalId: 'chapter-uuid-xyz' },
        badRequest: jest.fn(),
        notFound: jest.fn(),
        send: jest.fn((data) => data),
      };

      const res = await integrationController.getChapter(ctx);
      expect(res.published).toBe(true);
      expect(res.available).toBe(false);
    });

    it('should fallback to draft course if published course is not found, setting published/available to false', async () => {
      // First query for published course returns null
      mockCourseQuery.findOne.mockResolvedValueOnce(null);
      // Second query for any course (draft) returns draft course
      mockCourseQuery.findOne.mockResolvedValueOnce({
        id: 12,
        documentId: 'course-doc-draft',
        title: 'Upcoming Course',
        slug: 'upcoming-course',
        publishedAt: null,
        isChaptered: true,
        updatedAt: '2026-09-16T08:00:00.000Z',
        chapters: [
          {
            integrationId: 'chapter-uuid-draft',
            title: 'Draft Chapter',
            price: 200000,
          },
        ],
      });

      const ctx = {
        params: { externalId: 'chapter-uuid-draft' },
        badRequest: jest.fn(),
        notFound: jest.fn(),
        send: jest.fn((data) => data),
      };

      const res = await integrationController.getChapter(ctx);
      expect(res.published).toBe(false);
      expect(res.available).toBe(false);
      expect(res.externalId).toBe('chapter-uuid-draft');
      expect(res.parentExternalId).toBe('course-doc-draft');
    });
  });

  describe('Service Policy Security (is-service-authenticated)', () => {
    it('should allow access when valid X-Service-Key header is provided', () => {
      const policyCtx = {
        get: jest.fn((header) => (header === 'x-service-key' ? 'test-secret-key-123' : null)),
      };
      expect(isServiceAuthenticatedPolicy(policyCtx)).toBe(true);
    });

    it('should reject with UnauthorizedError when X-Service-Key is missing or invalid', () => {
      const policyCtxMissing = {
        get: jest.fn(() => null),
      };
      expect(() => isServiceAuthenticatedPolicy(policyCtxMissing)).toThrow('Unauthorized');

      const policyCtxWrong = {
        get: jest.fn(() => 'wrong-key'),
      };
      expect(() => isServiceAuthenticatedPolicy(policyCtxWrong)).toThrow('Unauthorized');
    });
  });
});

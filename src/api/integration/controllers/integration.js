'use strict';

const byeMoneyPurchaseService = require('../../../services/byeMoneyPurchaseService');

/**
 * ByeMoney <-> TarhElahi Integration Controller (v1)
 * Strict service-to-service read and webhook endpoints for ByeMoney.
 */
module.exports = {
  /**
   * GET /api/integrations/byemoney/v1/users/:externalUserId
   * Read authoritative user details for ByeMoney integration.
   * Resolves ONLY by the stable external identifier: user.documentId.
   * Numeric database IDs are NOT accepted.
   * Strictly excludes sensitive credentials (password, tokens, OTP).
   */
  async getUser(ctx) {
    const { externalUserId } = ctx.params;

    if (!externalUserId) {
      return ctx.badRequest('externalUserId is required');
    }

    // Strict lookup: resolve ONLY by the canonical external identifier (documentId)
    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { documentId: externalUserId },
    });

    if (!user) {
      return ctx.notFound('User not found');
    }

    // Strict whitelist-only DTO: zero leakage of password, tokens, OTP, or private data
    return ctx.send({
      externalUserId: user.documentId,
      phoneNumber: user.phoneNumber ?? null,
      email: user.email ?? null,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      confirmed: Boolean(user.confirmed),
      blocked: Boolean(user.blocked),
      isMobileVerified: Boolean(user.isMobileVerified),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  },

  /**
   * GET /api/integrations/byemoney/v1/courses/:externalId
   * Read authoritative course catalog DTO for ByeMoney integration.
   * Resolves ONLY by the stable external identifier: course.documentId.
   * Numeric database IDs are NOT accepted.
   * Authoritative Rial price and truthful published/available flags derived from existing system.
   */
  async getCourse(ctx) {
    const { externalId } = ctx.params;

    if (!externalId) {
      return ctx.badRequest('externalId is required');
    }

    // Strict lookup: resolve ONLY by the canonical external identifier (documentId)
    const course =
      (await strapi.db.query('api::course.course').findOne({
        where: { documentId: externalId, publishedAt: { $notNull: true } },
      })) ||
      (await strapi.db.query('api::course.course').findOne({
        where: { documentId: externalId },
      }));

    if (!course) {
      return ctx.notFound('Course not found');
    }

    // Truthful availability logic: in the current Strapi Course model, no separate
    // purchasability flag (active/salesEnabled) exists. Publication status is the
    // authoritative indicator of catalog availability.
    const isPublished = Boolean(course.publishedAt != null);
    const isAvailable = isPublished;

    return ctx.send({
      source: 'tarh_elahi',
      type: 'course',
      externalId: course.documentId,
      parentExternalId: null,
      title: course.title,
      slug: course.slug,
      priceRial: Number(course.price ?? 0),
      published: isPublished,
      available: isAvailable,
      updatedAt: course.updatedAt,
    });
  },

  /**
   * GET /api/integrations/byemoney/v1/chapters/:externalId
   * Read authoritative course chapter catalog DTO for ByeMoney integration.
   * Resolves by chapter.integrationId (UUID).
   * Returns type='course_chapter', externalId, and parentExternalId=course.documentId.
   */
  async getChapter(ctx) {
    const { externalId } = ctx.params;

    if (!externalId || !externalId.trim()) {
      return ctx.badRequest('externalId is required');
    }

    const trimmedExternalId = externalId.trim();

    // Find course containing the chapter (prefer published version)
    let course =
      (await strapi.db.query('api::course.course').findOne({
        where: {
          chapters: { integrationId: trimmedExternalId },
          publishedAt: { $notNull: true },
        },
        populate: ['chapters'],
      })) ||
      (await strapi.db.query('api::course.course').findOne({
        where: {
          chapters: { integrationId: trimmedExternalId },
        },
        populate: ['chapters'],
      }));

    if (!course || !Array.isArray(course.chapters)) {
      return ctx.notFound('Chapter not found');
    }

    const chapterIndex = course.chapters.findIndex(
      (ch) => ch && ch.integrationId === trimmedExternalId
    );

    if (chapterIndex === -1) {
      return ctx.notFound('Chapter not found');
    }

    const chapter = course.chapters[chapterIndex];
    const isPublished = Boolean(course.publishedAt != null);
    const isAvailable = Boolean(isPublished && (course.isChaptered ?? true));

    return ctx.send({
      source: 'tarh_elahi',
      type: 'course_chapter',
      externalId: chapter.integrationId,
      parentExternalId: course.documentId,
      title: chapter.title,
      slug: course.slug ? `${course.slug}-chapter-${chapterIndex + 1}` : null,
      priceRial: Number(chapter.price ?? 0),
      duration: chapter.duration ?? '00:00',
      published: isPublished,
      available: isAvailable,
      updatedAt: course.updatedAt,
    });
  },

  /**
   * GET /api/integrations/byemoney/v1/products/:externalId
   * Read authoritative product catalog DTO for ByeMoney integration.
   * Resolves by product.documentId.
   */
  async getProduct(ctx) {
    const { externalId } = ctx.params;

    if (!externalId || !externalId.trim()) {
      return ctx.badRequest('externalId is required');
    }

    const trimmedExternalId = externalId.trim();

    // Strict lookup: resolve ONLY by the canonical external identifier (documentId)
    const product =
      (await strapi.db.query('api::product.product').findOne({
        where: { documentId: trimmedExternalId, publishedAt: { $notNull: true } },
      })) ||
      (await strapi.db.query('api::product.product').findOne({
        where: { documentId: trimmedExternalId },
      }));

    if (!product) {
      return ctx.notFound('Product not found');
    }

    const isPublished = Boolean(product.publishedAt != null);
    const isAvailable = Boolean(
      isPublished && (product.isAvailable ?? true) && ((product.stock ?? 1) > 0)
    );

    return ctx.send({
      source: 'tarh_elahi',
      type: 'product',
      externalId: product.documentId,
      parentExternalId: null,
      title: product.title,
      slug: product.slug,
      priceRial: Number(product.price ?? 0),
      stock: Number(product.stock ?? 0),
      published: isPublished,
      available: isAvailable,
      updatedAt: product.updatedAt,
    });
  },

  /**
   * POST /api/integrations/byemoney/v1/purchases/confirm
   * Receives course purchase confirmation webhook from ByeMoney.
   * Grants user access to the course idempotently.
   */
  async confirmPurchase(ctx) {
    try {
      const payload = ctx.request.body;
      const result = await byeMoneyPurchaseService.confirmPurchase(payload);

      ctx.status = result.httpStatus;
      ctx.body = result.response;
      return ctx.body;
    } catch (error) {
      strapi.log?.error?.(`[ByeMoney Purchase Webhook] Unexpected error: ${error.message}`);
      ctx.status = 500;
      ctx.body = {
        success: false,
        purchaseId: typeof ctx.request?.body?.purchaseId === 'string' ? ctx.request.body.purchaseId : '',
        status: 'error',
        message: 'Internal server error while processing purchase confirmation',
      };
      return ctx.body;
    }
  },
};

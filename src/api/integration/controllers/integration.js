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

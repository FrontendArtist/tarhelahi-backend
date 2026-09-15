'use strict';

/**
 * Validates the purchase confirmation payload.
 * Requires non-empty string values for purchaseId, strapiUserId, and courseId.
 *
 * @param {object} payload - The request body.
 * @returns {{ isValid: boolean, message?: string, sanitized?: { purchaseId: string, strapiUserId: string, courseId: string } }}
 */
function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      isValid: false,
      message: 'Missing or invalid request payload: body must be a JSON object',
    };
  }

  const { purchaseId, strapiUserId, courseId } = payload;

  if (typeof purchaseId !== 'string' || !purchaseId.trim()) {
    return {
      isValid: false,
      message: 'Field purchaseId is required and must be a non-empty string',
    };
  }

  if (typeof strapiUserId !== 'string' || !strapiUserId.trim()) {
    return {
      isValid: false,
      message: 'Field strapiUserId is required and must be a non-empty string',
    };
  }

  if (typeof courseId !== 'string' || !courseId.trim()) {
    return {
      isValid: false,
      message: 'Field courseId is required and must be a non-empty string',
    };
  }

  return {
    isValid: true,
    sanitized: {
      purchaseId: purchaseId.trim(),
      strapiUserId: strapiUserId.trim(),
      courseId: courseId.trim(),
    },
  };
}

/**
 * Confirms course purchase webhook idempotently and grants course access.
 *
 * @param {object} payload - Webhook JSON body.
 * @param {object} [options]
 * @param {object} [options.strapiInstance] - Injected Strapi instance for testing.
 * @returns {Promise<{ httpStatus: number, response: { success: boolean, purchaseId: string, status: string, message?: string } }>}
 */
async function confirmPurchase(payload, { strapiInstance } = {}) {
  const strapiObj = strapiInstance || global.strapi;

  // 1. Validate payload
  const validation = validatePayload(payload);
  if (!validation.isValid) {
    const rawPurchaseId =
      payload && typeof payload.purchaseId === 'string' ? payload.purchaseId.trim() : '';
    return {
      httpStatus: 400,
      response: {
        success: false,
        purchaseId: rawPurchaseId,
        status: 'error',
        message: validation.message,
      },
    };
  }

  const { purchaseId, strapiUserId, courseId } = validation.sanitized;

  // 2. Look up an existing log entry by purchaseId for idempotency and conflict detection
  const existingLog = await strapiObj.db.query('api::byemoney-purchase-log.byemoney-purchase-log').findOne({
    where: { purchaseId },
  });

  if (existingLog) {
    // Idempotent replay check: exact same user and course
    if (existingLog.strapiUserId === strapiUserId && existingLog.courseId === courseId) {
      return {
        httpStatus: 200,
        response: {
          success: true,
          purchaseId,
          status: 'already_granted',
          message: 'Purchase was already processed and access granted',
        },
      };
    }

    // Conflict check: same purchaseId with different user or course
    return {
      httpStatus: 409,
      response: {
        success: false,
        purchaseId,
        status: 'conflict',
        message: 'Conflict: purchaseId already exists with different strapiUserId or courseId',
      },
    };
  }

  // 3. Look up user (by documentId)
  const user = await strapiObj.db.query('plugin::users-permissions.user').findOne({
    where: { documentId: strapiUserId },
  });

  if (!user) {
    return {
      httpStatus: 404,
      response: {
        success: false,
        purchaseId,
        status: 'error',
        message: `User not found with strapiUserId: ${strapiUserId}`,
      },
    };
  }

  // 4. Look up course (by documentId)
  const course =
    (await strapiObj.db.query('api::course.course').findOne({
      where: { documentId: courseId, publishedAt: { $notNull: true } },
      populate: ['users_permissions_users'],
    })) ||
    (await strapiObj.db.query('api::course.course').findOne({
      where: { documentId: courseId },
      populate: ['users_permissions_users'],
    }));

  if (!course) {
    return {
      httpStatus: 404,
      response: {
        success: false,
        purchaseId,
        status: 'error',
        message: `Course not found with courseId: ${courseId}`,
      },
    };
  }

  // 5. Grant access: connect user to course via users_permissions_users
  const existingUserIds = (course.users_permissions_users || []).map((u) => u.id).filter(Boolean);
  const mergedUserIds = [...new Set([...existingUserIds, user.id])];

  await strapiObj.db.query('api::course.course').update({
    where: { id: course.id },
    data: {
      users_permissions_users: mergedUserIds,
    },
  });

  // 6. Record idempotency log entry
  try {
    await strapiObj.db.query('api::byemoney-purchase-log.byemoney-purchase-log').create({
      data: {
        purchaseId,
        strapiUserId,
        courseId,
        status: 'processed',
      },
    });
  } catch (err) {
    // Handle concurrent requests race condition gracefully
    const raceCheck = await strapiObj.db.query('api::byemoney-purchase-log.byemoney-purchase-log').findOne({
      where: { purchaseId },
    });

    if (raceCheck && raceCheck.strapiUserId === strapiUserId && raceCheck.courseId === courseId) {
      return {
        httpStatus: 200,
        response: {
          success: true,
          purchaseId,
          status: 'already_granted',
          message: 'Purchase was already processed and access granted',
        },
      };
    }

    throw err;
  }

  return {
    httpStatus: 200,
    response: {
      success: true,
      purchaseId,
      status: 'granted',
      message: 'Course access granted successfully',
    },
  };
}

module.exports = {
  validatePayload,
  confirmPurchase,
};

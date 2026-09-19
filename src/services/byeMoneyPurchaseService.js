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
 * Detects whether an error represents a database unique-constraint or duplicate-entry violation.
 * Handles Postgres (23505), SQLite (SQLITE_CONSTRAINT), MySQL (ER_DUP_ENTRY / 1062),
 * Strapi / Objection ValidationError, and duplicate key message patterns.
 *
 * @param {any} err - The caught error.
 * @returns {boolean}
 */
function isUniqueConstraintError(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const errno = Number(err.errno);
  if (code === '23505' || code === 'SQLITE_CONSTRAINT' || code === 'ER_DUP_ENTRY' || errno === 1062) {
    return true;
  }
  const message = String(err.message || '').toLowerCase();
  const name = String(err.name || '').toLowerCase();
  return (
    name.includes('unique') ||
    (name.includes('validationerror') && message.includes('unique')) ||
    message.includes('unique constraint') ||
    message.includes('duplicate key') ||
    message.includes('duplicate entry') ||
    message.includes('must be unique') ||
    message.includes('already exists')
  );
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

  // 3. Look up user (by documentId or numeric id)
  const user =
    (await strapiObj.db.query('plugin::users-permissions.user').findOne({
      where: { documentId: strapiUserId },
      populate: ['courses'],
    })) ||
    (/^\d+$/.test(strapiUserId)
      ? await strapiObj.db.query('plugin::users-permissions.user').findOne({
          where: { id: Number(strapiUserId) },
          populate: ['courses'],
        })
      : null);

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

  // 4. Look up course (by documentId or numeric id)
  const course =
    (await strapiObj.db.query('api::course.course').findOne({
      where: { documentId: courseId, publishedAt: { $notNull: true } },
      populate: ['users_permissions_users', 'chapters'],
    })) ||
    (await strapiObj.db.query('api::course.course').findOne({
      where: { documentId: courseId },
      populate: ['users_permissions_users', 'chapters'],
    })) ||
    (/^\d+$/.test(courseId)
      ? (await strapiObj.db.query('api::course.course').findOne({
          where: { id: Number(courseId), publishedAt: { $notNull: true } },
          populate: ['users_permissions_users', 'chapters'],
        })) ||
        (await strapiObj.db.query('api::course.course').findOne({
          where: { id: Number(courseId) },
          populate: ['users_permissions_users', 'chapters'],
        }))
      : null);

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

  // 5. Grant access: reflect many-to-many relationship on BOTH sides
  // 5a. Course side: connect user to course via users_permissions_users
  const existingUserIds = (course.users_permissions_users || [])
    .map((u) => (typeof u === 'object' && u !== null ? u.id : u))
    .filter(Boolean);
  const mergedUserIds = [...new Set([...existingUserIds, user.id])];

  await strapiObj.db.query('api::course.course').update({
    where: { id: course.id },
    data: {
      users_permissions_users: mergedUserIds,
    },
  });

  // 5b. User side: connect course to user via courses relation (and enrolledChapters if chapters exist)
  const existingCourseIds = (user.courses || [])
    .map((c) => (typeof c === 'object' && c !== null ? c.id : c))
    .filter(Boolean);
  const mergedCourseIds = [...new Set([...existingCourseIds, course.id])];

  const userUpdateData = {
    courses: mergedCourseIds,
  };

  if (Array.isArray(course.chapters) && course.chapters.length > 0) {
    const existingChapters = Array.isArray(user.enrolledChapters)
      ? user.enrolledChapters.map(Number).filter(Boolean)
      : [];
    const courseChapterIds = course.chapters
      .map((ch) => (typeof ch === 'object' && ch !== null ? Number(ch.id) : Number(ch)))
      .filter(Boolean);
    userUpdateData.enrolledChapters = [...new Set([...existingChapters, ...courseChapterIds])];
  }

  await strapiObj.db.query('plugin::users-permissions.user').update({
    where: { id: user.id },
    data: userUpdateData,
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
    // Narrow catch: only treat genuine DB unique-constraint violations as race conditions.
    // Unrelated errors (network drops, DB connection loss, disk errors) propagate as 500.
    if (!isUniqueConstraintError(err)) {
      throw err;
    }

    // Handle concurrent requests race condition: verify what the winning request committed
    const raceCheck = await strapiObj.db.query('api::byemoney-purchase-log.byemoney-purchase-log').findOne({
      where: { purchaseId },
    });

    if (raceCheck) {
      // Idempotent race: winning concurrent request had the exact same user and course
      if (raceCheck.strapiUserId === strapiUserId && raceCheck.courseId === courseId) {
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

      // True conflict: concurrent request with the same purchaseId had a different user or course
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
  isUniqueConstraintError,
};

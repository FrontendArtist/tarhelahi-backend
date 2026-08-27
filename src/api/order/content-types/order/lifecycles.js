'use strict';

/**
 * Order Lifecycle Hooks for Strapi v5
 * Automatically connects courses & enrolledChapters to the User when order status becomes paid.
 * Updates relations from the Course (Owner) side to ensure they display in the Strapi Admin UI.
 */

async function syncUserPurchases(orderIdentifier) {
  try {
    if (!orderIdentifier) return;

    let order = null;
    const isNumeric =
      typeof orderIdentifier === 'number' ||
      (typeof orderIdentifier === 'string' && /^\d+$/.test(orderIdentifier));

    // 1. Load order (try strapi.documents first if string documentId, then numeric id, then db.query)
    if (typeof strapi.documents === 'function' && typeof orderIdentifier === 'string' && !/^\d+$/.test(orderIdentifier)) {
      order = await strapi.documents('api::order.order').findOne({
        documentId: orderIdentifier,
        populate: ['user', 'items'],
      });
    }

    if (!order && isNumeric) {
      order = await strapi.db.query('api::order.order').findOne({
        where: { id: Number(orderIdentifier) },
        populate: ['user', 'items'],
      });
    }

    if (!order) {
      const orders = await strapi.db.query('api::order.order').findMany({
        where: { document_id: String(orderIdentifier) },
        populate: ['user', 'items'],
        orderBy: { id: 'asc' },
      });
      order = orders?.[0] || null;
    }

    if (!order || !order.user) return;

    // 2. Check if paid or confirmed
    const confirmedStatuses = ['paid', 'confirmed', 'processing', 'shipped', 'delivered'];
    const orderStatusPaid =
      typeof order.orderStatus === 'string' && confirmedStatuses.includes(order.orderStatus.trim().toLowerCase());
    const paymentStatusPaid =
      typeof order.paymentStatus === 'string' && order.paymentStatus.trim().toLowerCase() === 'paid';

    if (!orderStatusPaid && !paymentStatusPaid) return;

    const userId = order.user.id;
    const items = order.items || [];

    const courseIdsToConnect = new Set();
    const chapterIdsToConnect = new Set();

    for (const item of items) {
      // Chapter purchase
      if (item.chapterId) {
        chapterIdsToConnect.add(Number(item.chapterId));
      } else if (item.courseId || item.slug) {
        // Full course purchase
        let targetCourse = null;

        if (item.courseId && (typeof item.courseId === 'number' || /^\d+$/.test(String(item.courseId)))) {
          const courses = await strapi.db.query('api::course.course').findMany({
            where: {
              $or: [
                { id: Number(item.courseId) },
              ],
              published_at: { $notNull: true },
            },
          });
          targetCourse = courses?.[0] || null;

          if (!targetCourse) {
            targetCourse = await strapi.db.query('api::course.course').findOne({
              where: { id: Number(item.courseId) },
            });
          }
        }

        if (!targetCourse && item.slug) {
          const cleanSlug = item.slug.includes('-chapter-')
            ? item.slug.split('-chapter-')[0]
            : item.slug;
          const courses = await strapi.db.query('api::course.course').findMany({
            where: {
              slug: cleanSlug,
              published_at: { $notNull: true },
            },
          });
          targetCourse = courses?.[0] || null;

          if (!targetCourse) {
            targetCourse = await strapi.db.query('api::course.course').findOne({
              where: { slug: cleanSlug },
            });
          }
        }

        if (targetCourse && targetCourse.id) {
          courseIdsToConnect.add(targetCourse.id);
        }
      }
    }

    // 3. Fetch user
    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: userId },
    });

    if (!user) return;

    // 4. Sync courses relation (Update from Course side to ensure Admin UI registers the join)
    if (courseIdsToConnect.size > 0) {
      for (const courseId of courseIdsToConnect) {
        const course = await strapi.db.query('api::course.course').findOne({
          where: { id: courseId },
          populate: ['users_permissions_users'],
        });

        if (course) {
          const existingUserIds = (course.users_permissions_users || []).map((u) => u.id).filter(Boolean);
          const mergedUserIds = [...new Set([...existingUserIds, userId])];

          await strapi.db.query('api::course.course').update({
            where: { id: courseId },
            data: {
              users_permissions_users: mergedUserIds,
            },
          });
        }
      }
      console.log(`[Order Lifecycle] ✅ Connected courses [${Array.from(courseIdsToConnect)}] to user ${userId} from Course (Owner) side`);
    }

    // 5. Sync enrolledChapters JSON field
    if (chapterIdsToConnect.size > 0) {
      const existingChapters = Array.isArray(user.enrolledChapters)
        ? user.enrolledChapters.map(Number)
        : [];
      const newChapterIds = Array.from(chapterIdsToConnect);
      const mergedChapters = [...new Set([...existingChapters, ...newChapterIds])];

      await strapi.db.query('plugin::users-permissions.user').update({
        where: { id: userId },
        data: {
          enrolledChapters: mergedChapters,
        },
      });

      console.log(`[Order Lifecycle] ✅ Connected chapters [${mergedChapters}] to user ${userId}`);
    }

    console.log(`[Order Lifecycle] ✅ Synced user ${userId} purchases successfully`);
  } catch (error) {
    console.error('[Order Lifecycle Error]:', error.message || error);
  }
}


async function processProductStock(orderIdentifier) {
  try {
    if (!orderIdentifier) return;

    let order = null;
    const isNumeric =
      typeof orderIdentifier === 'number' ||
      (typeof orderIdentifier === 'string' && /^\d+$/.test(orderIdentifier));

    if (typeof strapi.documents === 'function' && typeof orderIdentifier === 'string' && !/^\d+$/.test(orderIdentifier)) {
      order = await strapi.documents('api::order.order').findOne({
        documentId: orderIdentifier,
        populate: ['items'],
      });
    }

    if (!order && isNumeric) {
      order = await strapi.db.query('api::order.order').findOne({
        where: { id: Number(orderIdentifier) },
        populate: ['items'],
      });
    }

    if (!order) {
      const orders = await strapi.db.query('api::order.order').findMany({
        where: { document_id: String(orderIdentifier) },
        populate: ['items'],
        orderBy: { id: 'asc' },
      });
      order = orders?.[0] || null;
    }

    if (!order || order.stockDeducted) return;

    const items = order.items || [];
    let updatedProductCount = 0;

    for (const item of items) {
      const isProduct =
        item.__component === 'order.product-order-item' ||
        (item.productId && !item.courseId && !item.chapterId) ||
        (!item.courseId && !item.chapterId && item.slug);

      if (!isProduct) continue;

      let targetProduct = null;

      if (item.productId && (typeof item.productId === 'number' || /^\d+$/.test(String(item.productId)))) {
        targetProduct = await strapi.db.query('api::product.product').findOne({
          where: { id: Number(item.productId) },
        });
      }

      if (!targetProduct && item.slug) {
        targetProduct = await strapi.db.query('api::product.product').findOne({
          where: { slug: item.slug },
        });
      }

      if (targetProduct && targetProduct.id) {
        const currentStock = typeof targetProduct.stock === 'number' ? targetProduct.stock : 0;
        const quantity = Math.max(1, Number(item.quantity) || 1);
        const newStock = Math.max(0, currentStock - quantity);
        const isAvailable = newStock > 0;

        await strapi.db.query('api::product.product').update({
          where: { id: targetProduct.id },
          data: {
            stock: newStock,
            isAvailable: isAvailable,
          },
        });

        updatedProductCount++;
        console.log(`[Order Lifecycle] 📦 Updated product "${targetProduct.title}" (ID: ${targetProduct.id}) stock: ${currentStock} -> ${newStock}, isAvailable: ${isAvailable}`);
      }
    }

    await strapi.db.query('api::order.order').update({
      where: { id: order.id },
      data: {
        stockDeducted: true,
      },
    });

    console.log(`[Order Lifecycle] ✅ Stock deducted for order ${order.id} (${updatedProductCount} products updated)`);
  } catch (error) {
    console.error('[Order Lifecycle processProductStock Error]:', error.message || error);
  }
}

const excelService = require('../../services/excel-export');

function autoUpdateExcelReport() {
  setImmediate(async () => {
    try {
      if (typeof strapi !== 'undefined' && strapi.db) {
        await excelService.generateAndSaveExcelReport();
      }
    } catch (err) {
      console.error('[Order Lifecycle Excel Auto-Sync Error]:', err.message || err);
    }
  });
}

module.exports = {
  async afterCreate(event) {
    try {
      const { result } = event;
      const targetId = result?.id || result?.documentId;
      if (targetId) {
        await processProductStock(targetId);
        await syncUserPurchases(targetId);
      }
      autoUpdateExcelReport();
    } catch (err) {
      console.error('[afterCreate Error]:', err.message || err);
    }
  },

  async afterUpdate(event) {
    try {
      const { result } = event;
      const targetId = result?.id || result?.documentId;
      if (targetId) {
        await processProductStock(targetId);
        await syncUserPurchases(targetId);
      }
      autoUpdateExcelReport();
    } catch (err) {
      console.error('[afterUpdate Error]:', err.message || err);
    }
  },

  async afterDelete(event) {
    try {
      autoUpdateExcelReport();
    } catch (err) {
      console.error('[afterDelete Error]:', err.message || err);
    }
  },
};


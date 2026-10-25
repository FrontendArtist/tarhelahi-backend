'use strict';

const { randomUUID } = require('node:crypto');
const factory = require('../../src/api/coupon/services/coupon');
const cartService = require('../../src/services/byeMoneyCartService');
const { createCheckout } = require('../../src/api/order/services/checkout-pricing');
const { confirmPurchase } = require('../../src/services/byeMoneyPurchaseService');

function buildMockSetup(initialData = {}) {
  const publishedCourse = {
    id: 10,
    documentId: 'course-doc-1',
    title: 'دوره نمونه',
    slug: 'sample-course',
    isChaptered: false,
    price: 100,
    publishedAt: new Date().toISOString(),
    users_permissions_users: initialData.courseUsers || [],
  };

  const draftCourse = {
    ...publishedCourse,
    id: 11,
    publishedAt: null,
    users_permissions_users: initialData.courseUsers || [],
  };

  const chapterId1 = randomUUID();
  const chapterId2 = randomUUID();

  const chapteredCourse = {
    id: 20,
    documentId: 'chaptered-parent-doc',
    title: 'دوره فصلی',
    slug: 'chaptered-course',
    isChaptered: true,
    price: 500,
    publishedAt: new Date().toISOString(),
    chapters: [
      { id: 201, integrationId: chapterId1, title: 'فصل ۱', price: 50 },
      { id: 202, integrationId: chapterId2, title: 'فصل ۲', price: 60 },
    ],
    users_permissions_users: initialData.chapteredCourseUsers || [],
  };

  const draftChapteredCourse = {
    ...chapteredCourse,
    id: 21,
    publishedAt: null,
    chapters: [
      { id: 301, integrationId: chapterId1, title: 'فصل ۱', price: 50 },
      { id: 302, integrationId: chapterId2, title: 'فصل ۲', price: 60 },
    ],
    users_permissions_users: initialData.chapteredCourseUsers || [],
  };

  const buyer = {
    id: 1,
    documentId: 'buyer-user-doc',
    confirmed: true,
    blocked: false,
    courses: initialData.userCourses || [],
    enrolledChapters: initialData.enrolledChapters || [],
    enrolledChapterIntegrationIds: initialData.enrolledChapterIntegrationIds || [],
  };

  const purchaseLogs = initialData.purchaseLogs ? [...initialData.purchaseLogs] : [];
  const paidOrders = initialData.paidOrders ? [...initialData.paidOrders] : [];
  const carts = [];

  const coupon = {
    documentId: 'coupon-1',
    code: 'OFF10',
    isActive: true,
    discountType: 'percentage',
    discountValue: 10,
    appliesToAllCourses: true,
  };

  const allCourses = [publishedCourse, draftCourse, chapteredCourse, draftChapteredCourse];

  const strapi = {
    contentType: () => ({}),
    documents: (uid) => ({
      findOne: async ({ documentId, status }) => {
        if (uid === 'api::course.course') {
          return allCourses.find(
            (c) => c.documentId === documentId && (status !== 'published' || c.publishedAt)
          );
        }
        return null;
      },
      findMany: async () => (uid === 'api::coupon.coupon' ? [coupon] : []),
    }),
    db: {
      transaction: async (cb) => cb({ trx: { raw: jest.fn() } }),
      query: (uid) => {
        if (uid === 'api::course.course') {
          return {
            findOne: async ({ where }) => {
              if (where.chapters?.integrationId) {
                return allCourses.find(
                  (c) =>
                    (!where.documentId || c.documentId === where.documentId) &&
                    (!where.publishedAt || c.publishedAt) &&
                    (c.chapters || []).some((ch) => ch.integrationId === where.chapters.integrationId)
                );
              }
              return allCourses.find(
                (c) =>
                  (!where.documentId || c.documentId === where.documentId) &&
                  (!where.id || c.id === where.id) &&
                  (!where.publishedAt || c.publishedAt)
              );
            },
            findMany: async ({ where = {} } = {}) => {
              return allCourses.filter(
                (c) =>
                  (!where.documentId || c.documentId === where.documentId) &&
                  (!where.publishedAt || c.publishedAt)
              );
            },
            update: jest.fn(),
          };
        }
        if (uid === 'plugin::users-permissions.user') {
          return {
            findOne: async ({ where }) => {
              if (where.documentId && where.documentId === buyer.documentId) return buyer;
              if (where.id && Number(where.id) === buyer.id) return buyer;
              return null;
            },
            update: jest.fn(async ({ data }) => Object.assign(buyer, data)),
          };
        }
        if (uid === 'api::byemoney-purchase-log.byemoney-purchase-log') {
          return {
            findMany: async ({ where }) => {
              return purchaseLogs.filter((log) => {
                const userMatch = Array.isArray(where.strapiUserId?.$in)
                  ? where.strapiUserId.$in.includes(log.strapiUserId)
                  : log.strapiUserId === where.strapiUserId;
                const statusMatch = !where.status || log.status === where.status;
                return userMatch && statusMatch;
              });
            },
            findOne: async ({ where }) => purchaseLogs.find((l) => l.purchaseId === where.purchaseId),
            create: jest.fn(async ({ data }) => purchaseLogs.push(data)),
          };
        }
        if (uid === 'api::order.order') {
          return {
            findMany: async ({ where }) => {
              return paidOrders.filter((order) => {
                const userMatch =
                  order.user === where.user?.id ||
                  order.user?.id === where.user?.id ||
                  order.user?.documentId === where.user?.documentId;
                return userMatch;
              });
            },
            findOne: async ({ where }) => paidOrders.find((o) => o.id === where.id),
          };
        }
        if (uid === 'api::byemoney-cart.byemoney-cart') {
          return {
            findOne: async ({ where }) => carts.find((c) => c.cartId === where.cartId),
            create: jest.fn(async ({ data }) => carts.push({ id: carts.length + 1, ...data })),
            update: jest.fn(async ({ where, data }) => {
              const cart = carts.find((c) => c.id === where.id || c.cartId === where.cartId);
              if (cart) Object.assign(cart, data);
              return cart;
            }),
          };
        }
        return { findOne: async () => null, findMany: async () => [] };
      },
    },
  };

  const couponService = factory({ strapi });
  strapi.service = (name) => {
    if (name === 'api::coupon.coupon') return couponService;
    return {};
  };

  return {
    strapi,
    buyer,
    publishedCourse,
    draftCourse,
    chapteredCourse,
    chapterId1,
    chapterId2,
    purchaseLogs,
    paidOrders,
    carts,
  };
}

describe('جلوگیری از تأیید سبد و خرید مجدد دوره تحت مالکیت', () => {
  test('مالکیت از طریق user.courses (با documentId) در مرحلهٔ preview و prepare و check مسدود می‌شود', async () => {
    const setup = buildMockSetup({
      userCourses: [{ id: 10, documentId: 'course-doc-1' }],
    });

    const cartInput = {
      cartId: randomUUID(),
      buyerExternalUserId: 'buyer-user-doc',
      externalCourseIds: ['course-doc-1'],
    };

    // ۱. مسدود شدن در پیش‌نمایش
    await expect(cartService.preview(setup.strapi, cartInput)).rejects.toMatchObject({
      code: 'CART_UNAVAILABLE',
      status: 409,
      reason: 'ALREADY_OWNED',
    });

    // ۲. مسدود شدن در آماده‌سازی سبد
    await expect(cartService.prepare(setup.strapi, cartInput)).rejects.toMatchObject({
      code: 'CART_UNAVAILABLE',
      status: 409,
      reason: 'ALREADY_OWNED',
    });
  });

  test('مالکیت با شناسه عددی نسخه پیش‌نویس (بدون documentId در آبجکت رابطه) بر اساس شناسه سند مسدود می‌شود', async () => {
    // کاربر دوره را با شناسه عددی نسخه پیش‌نویس (11) دارد، اما نسخه منتشرشده شناسه 10 دارد
    const setup = buildMockSetup({
      userCourses: [11], // شناسه عددی نسخه پیش‌نویس
    });

    const cartInput = {
      cartId: randomUUID(),
      buyerExternalUserId: 'buyer-user-doc',
      externalCourseIds: ['course-doc-1'],
    };

    await expect(cartService.preview(setup.strapi, cartInput)).rejects.toMatchObject({
      code: 'CART_UNAVAILABLE',
      status: 409,
      reason: 'ALREADY_OWNED',
    });
  });

  test('مالکیت از طریق رابطه معکوس course.users_permissions_users مسدود می‌شود', async () => {
    const setup = buildMockSetup({
      courseUsers: [{ id: 1, documentId: 'buyer-user-doc' }],
    });

    const cartInput = {
      cartId: randomUUID(),
      buyerExternalUserId: 'buyer-user-doc',
      externalCourseIds: ['course-doc-1'],
    };

    await expect(cartService.preview(setup.strapi, cartInput)).rejects.toMatchObject({
      code: 'CART_UNAVAILABLE',
      status: 409,
      reason: 'ALREADY_OWNED',
    });
  });

  test('مالکیت قبلی ناشی از سفارش پرداخت‌شده قدیمی (api::order.order) مانع تأیید و خرید مجدد می‌شود', async () => {
    const setup = buildMockSetup({
      paidOrders: [
        {
          id: 99,
          user: 1,
          orderStatus: 'paid',
          paymentStatus: 'paid',
          items: [
            {
              __component: 'order.course-order-item',
              courseId: 10,
              slug: 'sample-course',
              chapterId: null,
            },
          ],
        },
      ],
    });

    const cartInput = {
      cartId: randomUUID(),
      buyerExternalUserId: 'buyer-user-doc',
      externalCourseIds: ['course-doc-1'],
    };

    await expect(cartService.preview(setup.strapi, cartInput)).rejects.toMatchObject({
      code: 'CART_UNAVAILABLE',
      status: 409,
      reason: 'ALREADY_OWNED',
    });

    await expect(cartService.prepare(setup.strapi, cartInput)).rejects.toMatchObject({
      code: 'CART_UNAVAILABLE',
      status: 409,
      reason: 'ALREADY_OWNED',
    });
  });

  test('سفارش لغوشده و پرداخت‌نشده مانع خرید دوره نیست', async () => {
    const setup = buildMockSetup({
      paidOrders: [
        {
          id: 100,
          user: 1,
          orderStatus: 'canceled',
          paymentStatus: 'pending_payment',
          items: [
            {
              __component: 'order.course-order-item',
              courseId: 10,
              slug: 'sample-course',
            },
          ],
        },
      ],
    });

    const cartInput = {
      cartId: randomUUID(),
      buyerExternalUserId: 'buyer-user-doc',
      externalCourseIds: ['course-doc-1'],
    };

    const quote = await cartService.preview(setup.strapi, cartInput);
    expect(quote.originalTotalInNoor).toBe(100);
  });

  test('مالکیت ثبت‌شده در لاگ بای‌مانی (byemoney-purchase-log) خرید مجدد را مسدود می‌کند', async () => {
    const setup = buildMockSetup({
      purchaseLogs: [
        {
          purchaseId: randomUUID(),
          strapiUserId: 'buyer-user-doc',
          courseId: 'course-doc-1',
          itemType: 'course',
          status: 'processed',
        },
      ],
    });

    const cartInput = {
      cartId: randomUUID(),
      buyerExternalUserId: 'buyer-user-doc',
      externalCourseIds: ['course-doc-1'],
    };

    await expect(cartService.preview(setup.strapi, cartInput)).rejects.toMatchObject({
      code: 'CART_UNAVAILABLE',
      status: 409,
      reason: 'ALREADY_OWNED',
    });
  });

  test('داشتن دورهٔ والد مانع از خرید فصل آن دوره با خطای مشخص می‌شود', async () => {
    const setup = buildMockSetup({
      userCourses: [{ id: 20, documentId: 'chaptered-parent-doc' }],
    });

    const cartInput = {
      cartId: randomUUID(),
      buyerExternalUserId: 'buyer-user-doc',
      externalCourseIds: [setup.chapterId1],
    };

    await expect(cartService.prepare(setup.strapi, cartInput)).rejects.toMatchObject({
      code: 'CART_UNAVAILABLE',
      status: 409,
      reason: 'ALREADY_OWNED',
      message: 'این دوره یا دورهٔ والد فصل قبلاً خریداری شده است.',
    });
  });

  test('داشتن یک فصل مانع از خرید مجدد همان فصل می‌شود، اما خرید فصل دیگر همان دوره مجاز است', async () => {
    const setup = buildMockSetup({
      enrolledChapters: [201], // کاربر فصل ۱ را دارد
    });

    // ۱. خرید مجدد فصل ۱ باید مسدود شود
    await expect(
      cartService.prepare(setup.strapi, {
        cartId: randomUUID(),
        buyerExternalUserId: 'buyer-user-doc',
        externalCourseIds: [setup.chapterId1],
      })
    ).rejects.toMatchObject({
      code: 'CART_UNAVAILABLE',
      status: 409,
      reason: 'ALREADY_OWNED',
      message: 'این فصل قبلاً خریداری شده است.',
    });

    // ۲. خرید فصل ۲ مجاز است و قیمت آن بازگردانده می‌شود
    const quote = await cartService.preview(setup.strapi, {
      buyerExternalUserId: 'buyer-user-doc',
      externalCourseIds: [setup.chapterId2],
    });
    expect(quote.originalTotalInNoor).toBe(60);
  });

  test('مرحلهٔ check سبد آماده را پس از اعطای دسترسی همزمان یا سابقه سفارش مسدود می‌کند', async () => {
    const setup = buildMockSetup();
    const cartInput = {
      cartId: randomUUID(),
      buyerExternalUserId: 'buyer-user-doc',
      externalCourseIds: ['course-doc-1'],
    };

    // در ابتدا سبد با موفقیت آماده می‌شود
    await cartService.prepare(setup.strapi, cartInput);

    // پیش از مرحلهٔ check، کاربر دسترسی دوره را از منبع دیگری دریافت می‌کند
    setup.buyer.courses = [{ documentId: 'course-doc-1' }];

    // مرحلهٔ check باید مسدود شود
    await expect(cartService.transition(setup.strapi, cartInput, 'check')).rejects.toMatchObject({
      code: 'CART_UNAVAILABLE',
      status: 409,
      reason: 'ALREADY_OWNED',
    });
  });

  test('درخواست ثبت سفارش مستقیم در استراپی (createCheckout) برای دوره تحت مالکیت مسدود می‌شود', async () => {
    const setup = buildMockSetup({
      userCourses: [{ id: 10, documentId: 'course-doc-1' }],
    });

    const checkoutInput = {
      user: 1,
      cartItems: [{ type: 'course', documentId: 'course-doc-1' }],
      paymentMethod: 'online',
    };

    await expect(
      createCheckout(setup.strapi, checkoutInput, async (data) => data)
    ).rejects.toMatchObject({
      code: 'CART_UNAVAILABLE',
      status: 409,
      reason: 'ALREADY_OWNED',
    });
  });

  test('وبهوک تحویل (confirmPurchase) در صورت retry همان خرید رفتار idempotent (already_granted) را حفظ می‌کند', async () => {
    const setup = buildMockSetup();
    const purchaseId = randomUUID();

    const payload = {
      purchaseId,
      buyerExternalUserId: 'buyer-user-doc',
      courseId: 'course-doc-1',
    };

    // بار اول: دسترسی اعطا می‌شود
    const firstResult = await confirmPurchase(payload, { strapiInstance: setup.strapi });
    expect(firstResult.httpStatus).toBe(200);
    expect(firstResult.response.status).toBe('granted');

    // بار دوم (retry همان purchaseId): به صورت no-op و موفق status: already_granted می‌دهد
    const secondResult = await confirmPurchase(payload, { strapiInstance: setup.strapi });
    expect(secondResult.httpStatus).toBe(200);
    expect(secondResult.response.status).toBe('already_granted');
  });
});

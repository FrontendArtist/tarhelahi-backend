'use strict';
const controller = require('../../src/api/integration/controllers/integration');

const USER_UID = 'plugin::users-permissions.user';

function setup({ role = 'administrator', beneficiary = { documentId: 'ben', confirmed: true, blocked: false, courses: [] } } = {}) {
  const writes = jest.fn(() => { throw new Error('پیش‌نمایش نباید داده‌ای بنویسد.'); });
  const course = { id: 1, documentId: 'c1', title: 'دوره', price: 105, internationalPrice: 801, discountPercent: 10 };
  const strapi = {
    contentType: () => ({}),
    documents: () => ({ findOne: async ({ documentId }) => (documentId === 'c1' ? course : null) }),
    plugin: () => ({ service: () => ({ getToken: async () => ({ documentId: 'admin' }) }) }),
    service: () => ({ consumeCoupon: writes }),
    db: {
      transaction: writes,
      query: (uid) => {
        if (uid === 'api::course.course') return { findOne: async () => null, findMany: async () => [] };
        if (uid !== USER_UID) throw new Error('پیش‌نمایش نباید جدول رزرو را بخواند.');
        return {
          create: writes, update: writes,
          findOne: async ({ where }) => {
            if (where.documentId === 'admin') return { documentId: 'admin', role: { type: role } };
            return where.documentId === 'ben' ? beneficiary : null;
          },
        };
      },
    },
  };
  global.strapi = strapi;
  return { strapi, writes };
}

async function call(body) {
  const ctx = {
    state: { user: { documentId: 'admin' } }, request: { body }, headers: {}, set: jest.fn(),
    forbidden: jest.fn((m) => { ctx.status = 403; ctx.body = { error: m }; }),
    notFound: jest.fn((m) => { ctx.status = 404; ctx.body = { error: m }; }),
  };
  await controller.previewAdminCart(ctx);
  return ctx;
}
const items = [{ externalId: 'c1', type: 'course', quantity: 1 }];

test.each([[false, 105, 95], [true, 801, 801]])('قیمت از هویت ذخیره‌شدهٔ ذینفع می‌آید: خارجی=%s', async (isForeign, base, price) => {
  const { writes } = setup({ beneficiary: { documentId: 'ben', confirmed: true, courses: [], is_foreigner: isForeign } });
  const ctx = await call({ beneficiaryExternalUserId: 'ben', items });
  expect(ctx.status).toBeUndefined();
  expect(ctx.body).toMatchObject({ originalTotalInNoor: base, priceInNoor: price });
  expect(ctx.body.cartId).toBeUndefined();
  expect(writes).not.toHaveBeenCalled();
});

test('غیرادمین رد می‌شود و quote اجرا نمی‌شود', async () => {
  setup({ role: 'authenticated' });
  const ctx = await call({ beneficiaryExternalUserId: 'ben', items });
  expect(ctx.status).toBe(403);
});

test('ذینفع ناموجود ۴۰۴ می‌دهد', async () => {
  setup();
  expect((await call({ beneficiaryExternalUserId: 'nobody', items })).status).toBe(404);
});

test.each([
  [{ externalId: 'p1', type: 'product', quantity: 1 }],
])('کالا رد می‌شود', async (item) => {
  setup();
  const ctx = await call({ beneficiaryExternalUserId: 'ben', items: [item] });
  expect(ctx.status).toBe(400);
  expect(ctx.body.code).toBe('CART_INVALID');
});

test('خطای قلم با شکل {code,error,lineError} برمی‌گردد', async () => {
  setup();
  const ctx = await call({ beneficiaryExternalUserId: 'ben', items: [{ externalId: 'missing', type: 'course', quantity: 1 }] });
  expect(ctx.status).toBeGreaterThanOrEqual(400);
  expect(ctx.body).toMatchObject({ code: expect.any(String), error: expect.any(String) });
  expect(ctx.body.lineError).toMatchObject({ externalId: 'missing', type: 'course' });
});

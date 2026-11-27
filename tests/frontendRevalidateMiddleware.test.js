'use strict';

const {
  documentMiddleware,
  triggerFrontendRevalidate,
} = require('../src/services/frontendRevalidateMiddleware');

describe('frontendRevalidateMiddleware', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  let strapi;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      NEXT_FRONTEND_URL: 'http://localhost:3000/',
      REVALIDATE_SECRET: 'test-revalidate-secret',
    };
    strapi = { log: { warn: jest.fn(), info: jest.fn() } };
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  });

  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  test('پس از ویرایش یا انتشار محتوای عمومی وب‌هوک /api/revalidate را صدا می‌زند', async () => {
    const mw = documentMiddleware(strapi);
    const next = jest.fn().mockResolvedValue({ documentId: 'doc-1' });

    const res = await mw({ uid: 'api::surah.surah', action: 'publish' }, next);

    expect(res).toEqual({ documentId: 'doc-1' });
    expect(next).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/revalidate',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-revalidate-secret': 'test-revalidate-secret',
        },
        body: JSON.stringify({ uid: 'api::surah.surah', model: 'surah' }),
      }),
    );
  });

  test('برای عملیات خواندن یا مدل‌های غیرعمومی وب‌هوک ارسال نمی‌کند', async () => {
    const mw = documentMiddleware(strapi);
    const next = jest.fn().mockResolvedValue([]);

    await mw({ uid: 'api::course.course', action: 'findMany' }, next);
    await mw({ uid: 'api::order.order', action: 'create' }, next);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('در صورت نبود REVALIDATE_SECRET یا خطای شبکه، ذخیره Strapi را خراب نمی‌کند', async () => {
    delete process.env.REVALIDATE_SECRET;
    delete process.env.STRAPI_WEBHOOK_SECRET;
    expect(await triggerFrontendRevalidate('api::course.course', strapi)).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();

    process.env.REVALIDATE_SECRET = 'test-revalidate-secret';
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await triggerFrontendRevalidate('api::course.course', strapi)).toBe(false);
    expect(strapi.log.warn).toHaveBeenCalled();
  });
});

'use strict';

const rateLimitMiddleware = require('../../src/middlewares/rate-limit');

jest.mock('@strapi/strapi', () => ({
  factories: {
    createCoreController: (_uid, customizer) => {
      return customizer({
        strapi: {
          log: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
          db: {
            connection: {
              schema: { hasTable: jest.fn(async () => false) },
            },
          },
        },
      });
    },
  },
}));

const visitorStatController = require('../../src/api/visitor-stat/controllers/visitor-stat');

describe('Visitor-Stat Memory Bounds (M13) & Rate-Limit Middleware (SEC-07)', () => {
  beforeEach(() => {
    rateLimitMiddleware.resetRateLimitStores();
    visitorStatController._internal.activeSessions.clear();
    visitorStatController._internal.todayVisitorsMap.clear();
  });

  test('M13: rejects invalid or oversized visitorId with 400 and hides err.message on 500', async () => {
    const badIds = ['', 'bad id with spaces', '../etc/passwd', 'a'.repeat(65)];
    for (const visitorId of badIds) {
      const ctx = {
        request: { body: { visitorId, type: 'heartbeat' } },
        badRequest: jest.fn((msg) => ({ status: 400, msg })),
        send: jest.fn(),
      };
      await visitorStatController.track(ctx);
      expect(ctx.badRequest).toHaveBeenCalledTimes(1);
    }

    const boomCtx = {
      request: { body: { visitorId: 'valid-visitor-1', type: 'enter' } },
      badRequest: jest.fn(),
      send: jest.fn((body, status) => ({ body, status })),
    };
    const origCheck = global.strapi;
    visitorStatController._internal.todayVisitorsMap.clear();
    // Force an internal error via getter on body
    const throwingCtx = {
      get request() {
        throw new Error('SENSITIVE_INTERNAL_SQL_ERROR');
      },
      send: jest.fn((body, status) => ({ body, status })),
    };
    await visitorStatController.track(throwingCtx);
    expect(throwingCtx.send).toHaveBeenCalledWith(
      { success: false, error: 'خطای داخلی سرور' },
      500
    );
    global.strapi = origCheck;
  });

  test('M13: activeSessions and todayVisitorsMap are capped at MAX limits via LRU eviction', () => {
    const {
      activeSessions,
      todayVisitorsMap,
      MAX_ACTIVE_SESSIONS,
      MAX_DAILY_VISITORS,
      touchActiveSession,
      markTodayVisitor,
    } = visitorStatController._internal;

    const now = Date.now();
    for (let i = 0; i < MAX_ACTIVE_SESSIONS + 50; i++) {
      touchActiveSession(`s_${i}`, now);
    }
    expect(activeSessions.size).toBe(MAX_ACTIVE_SESSIONS);
    expect(activeSessions.has('s_0')).toBe(false);
    expect(activeSessions.has(`s_${MAX_ACTIVE_SESSIONS + 49}`)).toBe(true);

    for (let i = 0; i < MAX_DAILY_VISITORS + 25; i++) {
      markTodayVisitor(`v_${i}`, now);
    }
    expect(todayVisitorsMap.size).toBe(MAX_DAILY_VISITORS);
    expect(todayVisitorsMap.has('v_0')).toBe(false);
    expect(todayVisitorsMap.has(`v_${MAX_DAILY_VISITORS + 24}`)).toBe(true);
  });

  test('SEC-07: rate-limit enforces per-IP and normalized per-phone limits with 429', async () => {
    const mw = rateLimitMiddleware({
      keyPrefix: 'test-otp',
      windowMs: 60000,
      max: 5,
      phoneMax: 2,
    });

    const next = jest.fn(async () => {});

    // Same phone in different formats should hit phoneMax=2 on 3rd request
    const phones = ['09123456789', '+989123456789', '۰۹۱۲۳۴۵۶۷۸۹'];
    for (let i = 0; i < 3; i++) {
      const ctx = {
        ip: `10.0.0.${i + 1}`,
        request: { body: { phoneNumber: phones[i] } },
        set: jest.fn(),
        status: 200,
        body: null,
      };
      await mw(ctx, next);
      if (i < 2) {
        expect(ctx.status).toBe(200);
      } else {
        expect(ctx.status).toBe(429);
        expect(ctx.set).toHaveBeenCalledWith('Retry-After', expect.any(String));
      }
    }
    expect(next).toHaveBeenCalledTimes(2);
  });
});

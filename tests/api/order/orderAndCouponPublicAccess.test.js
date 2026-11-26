'use strict';

jest.mock('@strapi/strapi', () => ({
  factories: {
    createCoreRouter: jest.fn((uid, options = {}) => ({ uid, options })),
    createCoreController: jest.fn((uid, factory) => factory),
  },
}));

const orderRouter = require('../../../src/api/order/routes/order');
const couponRouter = require('../../../src/api/coupon/routes/coupon');
const customCouponRoutes = require('../../../src/api/coupon/routes/01-custom-coupon');
const orderControllerFactory = require('../../../src/api/order/controllers/order');
const {
  RESTRICTED_ACTIONS,
  NON_ADMIN_ROLE_TYPES,
  revokeSensitivePublicPermissions,
} = require('../../../src/services/securityPermissions');

describe('AUDIT-SEC-02 (LOG-008, LOG-009) — Restrict public/authenticated access to orders and coupons', () => {
  describe('Core router policies', () => {
    it.each(['find', 'findOne', 'create', 'update', 'delete'])(
      'order core router enforces global::is-admin-or-api-token on %s',
      (action) => {
        expect(orderRouter.uid).toBe('api::order.order');
        expect(orderRouter.options.config[action].policies).toContain('global::is-admin-or-api-token');
      },
    );

    it.each(['find', 'findOne', 'create', 'update', 'delete'])(
      'coupon core router enforces global::is-admin-or-api-token on %s',
      (action) => {
        expect(couponRouter.uid).toBe('api::coupon.coupon');
        expect(couponRouter.options.config[action].policies).toContain('global::is-admin-or-api-token');
      },
    );

    it('keeps POST /coupons/validate public with rate limiting', () => {
      const validateRoute = customCouponRoutes.routes.find(
        (route) => route.method === 'POST' && route.path === '/coupons/validate',
      );
      expect(validateRoute).toBeDefined();
      expect(validateRoute.config.auth).toBe(false);
      expect(validateRoute.config.middlewares).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'global::rate-limit' })]),
      );
    });
  });

  describe('Order controller find and findOne authorization', () => {
    let controller;

    beforeEach(() => {
      const mockStrapi = {
        contentType: jest.fn().mockReturnValue({}),
        service: jest.fn().mockReturnValue({}),
        db: { query: jest.fn(), connection: jest.fn() },
        log: { info: jest.fn(), error: jest.fn() },
      };
      controller = orderControllerFactory({ strapi: mockStrapi });
    });

    it.each(['find', 'findOne'])('forbids anonymous caller on %s', async (action) => {
      const ctx = {
        state: {},
        query: {},
        forbidden: jest.fn().mockReturnValue({ status: 403 }),
      };

      await controller[action](ctx);
      expect(ctx.forbidden).toHaveBeenCalledTimes(1);
    });

    it.each(['find', 'findOne'])('forbids normal authenticated user on %s', async (action) => {
      const ctx = {
        state: {
          auth: { strategy: { name: 'users-permissions' } },
          user: { id: 42, role: { type: 'authenticated' } },
        },
        query: {},
        forbidden: jest.fn().mockReturnValue({ status: 403 }),
      };

      await controller[action](ctx);
      expect(ctx.forbidden).toHaveBeenCalledTimes(1);
    });
  });

  describe('Bootstrap permission revocation', () => {
    it('deletes restricted order and coupon permissions for public and authenticated roles', async () => {
      const roleQuery = {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, type: 'public' },
          { id: 2, type: 'authenticated' },
        ]),
      };
      const permissionQuery = {
        findMany: jest.fn().mockResolvedValue([
          { id: 101, action: 'api::order.order.find' },
          { id: 102, action: 'api::order.order.findOne' },
          { id: 103, action: 'api::coupon.coupon.find' },
        ]),
        delete: jest.fn().mockResolvedValue({}),
      };

      const mockStrapi = {
        db: {
          query: jest.fn((uid) => {
            if (uid === 'plugin::users-permissions.role') return roleQuery;
            if (uid === 'plugin::users-permissions.permission') return permissionQuery;
            throw new Error(`Unexpected uid: ${uid}`);
          }),
        },
        log: { info: jest.fn() },
      };

      const result = await revokeSensitivePublicPermissions(mockStrapi);

      expect(result).toEqual({ removed: 3 });
      expect(roleQuery.findMany).toHaveBeenCalledWith({
        where: { type: { $in: NON_ADMIN_ROLE_TYPES } },
        select: ['id', 'type'],
      });
      expect(permissionQuery.findMany).toHaveBeenCalledWith({
        where: {
          role: { id: { $in: [1, 2] } },
          action: { $in: RESTRICTED_ACTIONS },
        },
        select: ['id', 'action'],
      });
      expect(permissionQuery.delete).toHaveBeenCalledTimes(3);
      expect(permissionQuery.delete).toHaveBeenCalledWith({ where: { id: 101 } });
      expect(permissionQuery.delete).toHaveBeenCalledWith({ where: { id: 102 } });
      expect(permissionQuery.delete).toHaveBeenCalledWith({ where: { id: 103 } });
    });

    it('returns removed=0 when no stale permissions exist', async () => {
      const mockStrapi = {
        db: {
          query: jest.fn((uid) => {
            if (uid === 'plugin::users-permissions.role') {
              return { findMany: jest.fn().mockResolvedValue([{ id: 1, type: 'public' }]) };
            }
            if (uid === 'plugin::users-permissions.permission') {
              return { findMany: jest.fn().mockResolvedValue([]), delete: jest.fn() };
            }
            throw new Error(`Unexpected uid: ${uid}`);
          }),
        },
        log: { info: jest.fn() },
      };

      const result = await revokeSensitivePublicPermissions(mockStrapi);
      expect(result).toEqual({ removed: 0 });
    });
  });
});

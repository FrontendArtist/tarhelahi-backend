'use strict';

const path = require('node:path');
const fs = require('node:fs');
const customOrderRoutes = require('../../../src/api/order/routes/01-custom-order');
const controllerFactory = require('../../../src/api/order/controllers/order');
const orderLifecycles = require('../../../src/api/order/content-types/order/lifecycles');
const excelExportService = require('../../../src/api/order/services/excel-export');

describe('AUDIT-SEC-01 (LOG-001) & AUDIT-LEGACY-01 (LOG-007)', () => {
  describe('01-custom-order.js route auth config', () => {
    it('requires authentication on export-excel, revenue-stats, sync-excel, and bulk-settle', () => {
      const protectedPaths = [
        '/orders/export-excel',
        '/orders/revenue-stats',
        '/orders/sync-excel',
        '/orders/bulk-settle',
      ];

      for (const routePath of protectedPaths) {
        const route = customOrderRoutes.routes.find((r) => r.path === routePath);
        expect(route).toBeDefined();
        expect(route.config?.auth).not.toBe(false);
      }
    });
  });

  describe('Order admin controller authorization', () => {
    let controller;

    beforeEach(() => {
      const mockStrapi = {
        contentType: jest.fn().mockReturnValue({}),
        service: jest.fn().mockReturnValue({}),
        db: { query: jest.fn(), connection: jest.fn() },
        log: { info: jest.fn(), error: jest.fn() },
      };
      controller = controllerFactory({ strapi: mockStrapi });
    });

    it.each(['exportExcel', 'revenueStats', 'syncExcel', 'bulkSettle'])(
      'forbids non-admin user on %s',
      async (action) => {
        const ctx = {
          state: {
            auth: { strategy: { name: 'users-permissions' } },
            user: { id: 10, role: { type: 'authenticated' } },
          },
          forbidden: jest.fn().mockReturnValue({ status: 403 }),
        };

        await controller[action](ctx);
        expect(ctx.forbidden).toHaveBeenCalledTimes(1);
      }
    );
  });

  describe('Excel report path outside public/', () => {
    it('writes default report outside public/ directory', async () => {
      const originalStrapi = global.strapi;
      const originalExistsSync = fs.existsSync;
      const originalMkdirSync = fs.mkdirSync;
      const originalBuild = excelExportService.buildOrdersWorkbook;

      global.strapi = {
        db: {
          query: jest.fn().mockReturnValue({
            findMany: jest.fn().mockResolvedValue([]),
          }),
        },
      };
      fs.existsSync = jest.fn().mockReturnValue(true);
      fs.mkdirSync = jest.fn();

      const writeFileMock = jest.fn().mockResolvedValue(undefined);
      // Mock exceljs Workbook writeFile via a spy on fs/path check:
      // generateAndSaveExcelReport calls buildOrdersWorkbook internally, so we test the returned filePath
      // using a temporary directory via cwd spy.
      const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(path.join(process.cwd(), 'tmp-test-root'));
      try {
        // Use a real temp dir so workbook.xlsx.writeFile succeeds cleanly
        const tmpRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'excel-sec-'));
        cwdSpy.mockReturnValue(tmpRoot);
        fs.existsSync = originalExistsSync;
        fs.mkdirSync = originalMkdirSync;

        const result = await excelExportService.generateAndSaveExcelReport();
        expect(result.success).toBe(true);
        expect(result.filePath).not.toContain(`${path.sep}public${path.sep}`);
        expect(result.filePath).toContain(`${path.sep}storage${path.sep}exports${path.sep}`);

        fs.rmSync(tmpRoot, { recursive: true, force: true });
      } finally {
        cwdSpy.mockRestore();
        fs.existsSync = originalExistsSync;
        fs.mkdirSync = originalMkdirSync;
        global.strapi = originalStrapi;
      }
    });
  });

  describe('AUDIT-LEGACY-01 (LOG-007) — block course/chapter/paid orders outside ByeMoney cart', () => {
    let controller;

    beforeEach(() => {
      const mockStrapi = {
        contentType: jest.fn().mockReturnValue({}),
        service: jest.fn().mockReturnValue({}),
      };
      controller = controllerFactory({ strapi: mockStrapi });
    });

    it('blocks order.create with course-order-item even for api-token', async () => {
      const ctx = {
        state: { auth: { strategy: { name: 'api-token' } } },
        request: {
          body: {
            data: {
              paymentMethod: 'online',
              items: [{ __component: 'order.course-order-item', courseId: 7 }],
            },
          },
        },
        badRequest: jest.fn().mockReturnValue({ status: 400 }),
      };

      await controller.create(ctx);
      expect(ctx.badRequest).toHaveBeenCalledTimes(1);
    });

    it('blocks order.create with orderStatus=paid even for administrator', async () => {
      const ctx = {
        state: {
          auth: { strategy: { name: 'users-permissions' } },
          user: { id: 1, role: { type: 'administrator' } },
        },
        request: {
          body: {
            data: {
              paymentMethod: 'online',
              orderStatus: 'paid',
              items: [{ __component: 'order.product-order-item', slug: 'book-1', quantity: 1 }],
            },
          },
        },
        badRequest: jest.fn().mockReturnValue({ status: 400 }),
      };

      await controller.create(ctx);
      expect(ctx.badRequest).toHaveBeenCalledTimes(1);
    });

    it('afterCreate lifecycle does not grant course or chapter access on new paid orders', async () => {
      const originalStrapi = global.strapi;
      const updateSpy = jest.fn();
      const syncOrderNotification = jest.fn().mockResolvedValue(undefined);

      global.strapi = {
        db: {
          query: jest.fn().mockReturnValue({
            findOne: jest.fn().mockResolvedValue({
              id: 99,
              orderStatus: 'paid',
              paymentStatus: 'paid',
              user: { id: 5 },
              items: [{ __component: 'order.course-order-item', courseId: 7, chapterId: 22 }],
            }),
            update: updateSpy,
          }),
        },
        service: jest.fn().mockReturnValue({ syncOrderNotification }),
      };

      try {
        await orderLifecycles.afterCreate({ result: { id: 99 } });
        expect(updateSpy).not.toHaveBeenCalled();
        expect(syncOrderNotification).toHaveBeenCalledWith(99);
      } finally {
        global.strapi = originalStrapi;
      }
    });
  });
});

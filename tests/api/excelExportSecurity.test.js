'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const excelExportService = require('../../src/api/order/services/excel-export');

const mockSuperController = {};
jest.mock('@strapi/strapi', () => ({
  factories: {
    createCoreController: (_uid, customizer) => {
      const overrides = customizer({
        strapi: {
          log: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
          db: { query: jest.fn() },
        },
      });
      Object.setPrototypeOf(overrides, mockSuperController);
      return overrides;
    },
  },
}));

const orderController = require('../../src/api/order/controllers/order');

describe('Excel Export Security (M6)', () => {
  test('DEFAULT_EXPORTS_DIR is outside public/', () => {
    const normalized = path.normalize(excelExportService.DEFAULT_EXPORTS_DIR).toLowerCase();
    expect(normalized).toContain(path.join('storage', 'exports').toLowerCase());
    expect(normalized).not.toContain(path.join('public', 'uploads').toLowerCase());
  });

  test('sanitizeExcelCell neutralizes formula injection prefixes', () => {
    expect(excelExportService.sanitizeExcelCell('=CMD()')).toBe("'=CMD()");
    expect(excelExportService.sanitizeExcelCell('+1234')).toBe("'+1234");
    expect(excelExportService.sanitizeExcelCell('-1234')).toBe("'-1234");
    expect(excelExportService.sanitizeExcelCell('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");
    expect(excelExportService.sanitizeExcelCell('-')).toBe('-');
    expect(excelExportService.sanitizeExcelCell('Ali Rezaei')).toBe('Ali Rezaei');
  });

  test('generateAndSaveExcelReport writes to custom/storage path outside public', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'excel-sec-'));
    const target = path.join(tempDir, 'orders_revenue_report.xlsx');
    global.strapi = {
      db: {
        query: jest.fn(() => ({
          findMany: jest.fn(async () => []),
        })),
      },
    };

    try {
      const result = await excelExportService.generateAndSaveExcelReport(target);
      expect(result.success).toBe(true);
      expect(result.fileName).toBe('orders_revenue_report.xlsx');
      expect(fs.existsSync(target)).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('order.exportExcel sets no-store and nosniff headers and does not leak err.message on 500', async () => {
    const spy = jest.spyOn(excelExportService, 'generateExcelBuffer').mockResolvedValueOnce({
      buffer: Buffer.from('xlsx-bytes'),
      stats: {},
      ordersCount: 0,
    });

    const headers = {};
    const ctx = {
      state: { auth: { strategy: { name: 'api-token' } } },
      set: jest.fn((k, v) => {
        headers[k] = v;
      }),
      forbidden: jest.fn((msg) => {
        throw new Error(`403:${msg}`);
      }),
      throw: jest.fn((status, msg) => {
        throw new Error(`${status}:${msg}`);
      }),
      body: null,
    };

    await orderController.exportExcel(ctx);
    expect(headers['Cache-Control']).toBe('no-store, private');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Content-Disposition']).toMatch(/^attachment; filename="/);
    expect(Buffer.isBuffer(ctx.body)).toBe(true);

    spy.mockRejectedValueOnce(new Error('SECRET_DB_CONN_STRING_LEAK'));
    await expect(orderController.exportExcel(ctx)).rejects.not.toThrow(/SECRET_DB_CONN_STRING_LEAK/);

    spy.mockRestore();
  });
});

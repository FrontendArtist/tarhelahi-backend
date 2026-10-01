'use strict';

const excelExportService = require('../../src/api/order/services/excel-export');

describe('Order Financial Metrics & Excel Separation (Noor vs Legacy Toman)', () => {
  it('should separate Noor and Legacy Toman orders without summing them together', () => {
    const mockOrders = [
      // Legacy order (currency = null or 'toman')
      {
        id: 1,
        totalPrice: 2500000,
        currency: null,
        paymentStatus: 'paid',
        orderStatus: 'paid',
        createdAt: '2026-08-01T10:00:00.000Z',
      },
      {
        id: 2,
        totalPrice: 1500000,
        currency: 'toman',
        paymentStatus: 'paid',
        orderStatus: 'paid',
        createdAt: '2026-08-10T10:00:00.000Z',
      },
      // New Noor orders (currency = 'noor')
      {
        id: 3,
        totalPrice: 250,
        currency: 'noor',
        purchaseId: 'BM-PURCHASE-001',
        paymentStatus: 'paid',
        orderStatus: 'paid',
        createdAt: '2026-10-01T10:00:00.000Z',
      },
      {
        id: 4,
        totalPrice: 150,
        currency: 'noor',
        purchaseId: 'BM-PURCHASE-002',
        paymentStatus: 'paid',
        orderStatus: 'paid',
        createdAt: '2026-10-01T11:00:00.000Z',
      },
      // New Free order in Noor
      {
        id: 5,
        totalPrice: 100, // list price before 100% discount
        isFree: true,
        paymentMethod: 'free',
        currency: 'noor',
        paymentStatus: 'paid',
        orderStatus: 'paid',
        createdAt: '2026-10-01T12:00:00.000Z',
      },
    ];

    const stats = excelExportService.calculateRevenueMetrics(mockOrders);

    // Verify separation
    expect(stats.noor).toBeDefined();
    expect(stats.legacy).toBeDefined();

    expect(stats.noor.unit).toBe('نور');
    expect(stats.legacy.unit).toBe('تومان');

    // Legacy totals: 2,500,000 + 1,500,000 = 4,000,000 Toman
    expect(stats.legacy.metrics.totalPaidOrders).toBe(2);
    expect(stats.legacy.metrics.totalRevenue).toBe(4000000);

    // Noor totals: 250 + 150 + 0 (free order contributes 0) = 400 Noor
    expect(stats.noor.metrics.totalPaidOrders).toBe(3);
    expect(stats.noor.metrics.totalFreeOrders).toBe(1);
    expect(stats.noor.metrics.totalRevenue).toBe(400);

    // Verify they are never mathematically summed:
    // stats.noor.metrics.totalRevenue is 400, NOT 4000400
    expect(stats.noor.metrics.totalRevenue).not.toBe(4000400);
  });
});

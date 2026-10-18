'use strict';

describe('Coupon Calculation - Cart and Restricted Rounding in Noor', () => {
  let couponService;
  let mockStrapi;

  beforeEach(() => {
    const couponFactory = require('../../src/api/coupon/services/coupon');
    const mockFindMany = jest.fn();
    mockStrapi = {
      contentType: jest.fn(() => ({ attributes: {} })),
      documents: jest.fn(() => ({
        findMany: mockFindMany,
      })),
      mockFindMany,
      db: {
        query: jest.fn(() => ({
          findMany: jest.fn(),
          update: jest.fn(),
        })),
        transaction: jest.fn(async (cb) => cb()),
      },
    };

    if (typeof couponFactory === 'function') {
      couponService = couponFactory({ strapi: mockStrapi });
    } else {
      couponService = couponFactory;
    }
    global.strapi = mockStrapi;
  });

  afterEach(() => {
    delete global.strapi;
    jest.clearAllMocks();
  });

  it('rounds a general percentage coupon once on the eligible subtotal', async () => {
    const mockCoupon = {
      documentId: 'cpn-doc-1',
      code: 'OFF15',
      title: '15% Off',
      isActive: true,
      discountType: 'percentage',
      discountValue: 15,
      appliesToAllCourses: true,
      appliesToAllProducts: true,
      minOrderAmount: 50,
      maxDiscountAmount: 0,
      startDate: null,
      expiresAt: null,
      maxUsage: 0,
    };

    mockStrapi.mockFindMany.mockResolvedValueOnce([mockCoupon]);

    // تخفیف عمومی: floor(68 × 15٪) = 10 نور؛ تخصیص ردیفی این جمع را حفظ می‌کند.
    const cartItems = [
      { id: 'item-1', price: 33, quantity: 1, type: 'course' },
      { id: 'item-2', price: 25, quantity: 1, type: 'course' },
      { id: 'item-3', price: 10, quantity: 1, type: 'product' },
    ];

    const result = await couponService.validateAndCalculate('OFF15', cartItems, 68);

    expect(result.valid).toBe(true);
    expect(result.discountAmount).toBe(10);
    expect(result.finalTotalPrice).toBe(58);
    expect(result.originalTotalPrice).toBe(68);
  });

  it('should format minOrderAmount error message with "نور" instead of "تومان"', async () => {
    const mockCoupon = {
      documentId: 'cpn-doc-2',
      code: 'HIGHMIN',
      isActive: true,
      discountType: 'percentage',
      discountValue: 10,
      appliesToAllCourses: true,
      minOrderAmount: 100, // Requires 100 Noor
      startDate: null,
      expiresAt: null,
    };

    mockStrapi.mockFindMany.mockResolvedValueOnce([mockCoupon]);

    const cartItems = [{ id: 'item-1', price: 40, quantity: 1, type: 'course' }];
    const result = await couponService.validateAndCalculate('HIGHMIN', cartItems, 40);

    expect(result.valid).toBe(false);
    expect(result.message).toContain('نور');
    expect(result.message).not.toContain('تومان');
  });
});

'use strict';

describe('Coupon Calculation - Row-by-Row Floor Rounding in Noor', () => {
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

  it('should calculate percentage discount per row rounded DOWN to integer Noor without secondary rounding', async () => {
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

    // Cart items:
    // Item 1: price = 33 Noor, qty = 1 -> row = 33 -> 15% of 33 = 4.95 -> Math.floor = 4 -> final row = 29
    // Item 2: price = 25 Noor, qty = 1 -> row = 25 -> 15% of 25 = 3.75 -> Math.floor = 3 -> final row = 22
    // Item 3: price = 10 Noor, qty = 1 -> row = 10 -> 15% of 10 = 1.50 -> Math.floor = 1 -> final row = 9
    // Total raw before discount = 33 + 25 + 10 = 68 Noor (>= minOrderAmount 50)
    // Total discount = 4 + 3 + 1 = 8 Noor
    // Final payable = 29 + 22 + 9 = 60 Noor (sum of row final prices, no secondary rounding)
    const cartItems = [
      { id: 'item-1', price: 33, quantity: 1, type: 'course' },
      { id: 'item-2', price: 25, quantity: 1, type: 'course' },
      { id: 'item-3', price: 10, quantity: 1, type: 'product' },
    ];

    const result = await couponService.validateAndCalculate('OFF15', cartItems, 68);

    expect(result.valid).toBe(true);
    expect(result.discountAmount).toBe(8);
    expect(result.finalTotalPrice).toBe(60);
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

'use strict';

const controllerFactory = require('../../../src/api/order/controllers/order');

describe('Order Controller - create (Light TopUp Guard)', () => {
  let controller;
  let mockStrapi;

  beforeEach(() => {
    mockStrapi = {
      contentType: jest.fn().mockReturnValue({}),
      service: jest.fn().mockReturnValue({}),
      entityService: {
        create: jest.fn().mockResolvedValue({ id: 1, orderStatus: 'pending' }),
      },
      db: {
        query: jest.fn().mockReturnValue({
          create: jest.fn().mockResolvedValue({ id: 1 }),
        }),
      },
    };

    controller = controllerFactory({ strapi: mockStrapi });
  });

  it('should block order creation when paymentMethod is card_to_card and item slug is light-topup', async () => {
    const ctx = {
      request: {
        body: {
          data: {
            paymentMethod: 'card_to_card',
            totalPrice: 100000,
            items: [
              {
                __component: 'order.product-order-item',
                slug: 'light-topup',
                title: 'شارژ نور',
                price: 100000,
              },
            ],
          },
        },
      },
      badRequest: jest.fn().mockReturnValue({ status: 400 }),
    };

    const res = await controller.create(ctx);

    expect(ctx.badRequest).toHaveBeenCalledWith(
      'شارژ نور از طریق کارت به کارت مستقیم کاربر غیرفعال است. لطفاً از درگاه پرداخت آنلاین استفاده فرمایید.'
    );
  });

  it('should block order creation when paymentMethod is card_to_card and item type is light_topup', async () => {
    const ctx = {
      request: {
        body: {
          data: {
            paymentMethod: 'card_to_card',
            items: [
              {
                type: 'light_topup',
                title: 'شارژ اعتبار نور',
              },
            ],
          },
        },
      },
      badRequest: jest.fn().mockReturnValue({ status: 400 }),
    };

    await controller.create(ctx);

    expect(ctx.badRequest).toHaveBeenCalledWith(
      'شارژ نور از طریق کارت به کارت مستقیم کاربر غیرفعال است. لطفاً از درگاه پرداخت آنلاین استفاده فرمایید.'
    );
  });

  it('should block order creation when paymentMethod is card_to_card and notes contains [LIGHT_AMOUNT:X]', async () => {
    const ctx = {
      request: {
        body: {
          data: {
            paymentMethod: 'card_to_card',
            notes: '📋 اقلام این سفارش:\n1. [شارژ نور] 50 نور [LIGHT_AMOUNT:50]',
          },
        },
      },
      badRequest: jest.fn().mockReturnValue({ status: 400 }),
    };

    await controller.create(ctx);

    expect(ctx.badRequest).toHaveBeenCalledWith(
      'شارژ نور از طریق کارت به کارت مستقیم کاربر غیرفعال است. لطفاً از درگاه پرداخت آنلاین استفاده فرمایید.'
    );
  });

  it('should block order creation when paymentMethod is card_to_card and notes contains [TOPUP_ID:X]', async () => {
    const ctx = {
      request: {
        body: {
          data: {
            paymentMethod: 'card_to_card',
            notes: '⚡ شناسه شارژ بای‌مانی: [TOPUP_ID:abc-123]',
          },
        },
      },
      badRequest: jest.fn().mockReturnValue({ status: 400 }),
    };

    await controller.create(ctx);

    expect(ctx.badRequest).toHaveBeenCalledWith(
      'شارژ نور از طریق کارت به کارت مستقیم کاربر غیرفعال است. لطفاً از درگاه پرداخت آنلاین استفاده فرمایید.'
    );
  });

  it('should allow regular product order with card_to_card paymentMethod', async () => {
    let superCalled = false;
    const ctx = {
      request: {
        body: {
          data: {
            paymentMethod: 'card_to_card',
            fullName: 'Ali Rezaei',
            items: [
              {
                __component: 'order.product-order-item',
                slug: 'book-tarh-elahi',
                title: 'کتاب طرح کلی اندیشه اسلامی',
                price: 150000,
              },
            ],
          },
        },
      },
      badRequest: jest.fn(),
    };

    // Replace the prototype create method (super.create) with a mock
    const originalSuperCreate = Object.getPrototypeOf(controller).create;
    Object.getPrototypeOf(controller).create = jest.fn().mockImplementation(async () => {
      superCalled = true;
      return { data: { id: 1 } };
    });

    try {
      await controller.create(ctx);
      expect(ctx.badRequest).not.toHaveBeenCalled();
      expect(superCalled).toBe(true);
    } finally {
      Object.getPrototypeOf(controller).create = originalSuperCreate;
    }
  });

  it('should allow online payment even if items include light-topup', async () => {
    let superCalled = false;
    const ctx = {
      request: {
        body: {
          data: {
            paymentMethod: 'online',
            items: [
              {
                slug: 'light-topup',
              },
            ],
          },
        },
      },
      badRequest: jest.fn(),
    };

    const originalSuperCreate = Object.getPrototypeOf(controller).create;
    Object.getPrototypeOf(controller).create = jest.fn().mockImplementation(async () => {
      superCalled = true;
      return { data: { id: 2 } };
    });

    try {
      await controller.create(ctx);
      expect(ctx.badRequest).not.toHaveBeenCalled();
      expect(superCalled).toBe(true);
    } finally {
      Object.getPrototypeOf(controller).create = originalSuperCreate;
    }
  });
});

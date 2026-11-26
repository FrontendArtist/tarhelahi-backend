'use strict';

jest.mock('../../src/services/stockReservation', () => {
  const actual = jest.requireActual('../../src/services/stockReservation');
  return {
    ...actual,
    lock: jest.fn(async () => {}),
    lockProducts: jest.fn(async () => {}),
    reserve: jest.fn(async () => ({ expires_at: '2026-11-26T12:00:00.000Z' })),
    transition: jest.fn(async () => ({ state: 'committed' })),
    available: jest.fn(async () => 5),
    inventory: jest.fn(async (_strapi, trx, externalId) => trx.__getInventory(externalId)),
    mirror: jest.fn(async () => {}),
  };
});

jest.mock('../../src/services/byeMoneyPurchaseService', () => ({
  confirmPurchase: jest.fn(async () => ({ httpStatus: 200, response: { ok: true } })),
}));

const stock = require('../../src/services/stockReservation');
const { confirmPurchase } = require('../../src/services/byeMoneyPurchaseService');
const service = require('../../src/services/physicalCartService');

const CART_ID = '11111111-1111-4111-8111-111111111111';
const BUYER_ID = 'buyer-1';
const PURCHASE_COURSE = 'aaaaaaaa-1111-4111-8111-111111111111';
const PURCHASE_CHAPTER = 'bbbbbbbb-1111-4111-8111-111111111111';
const PURCHASE_PRODUCT = 'cccccccc-1111-4111-8111-111111111111';
const OP_PARTIAL = 'dddddddd-1111-4111-8111-111111111111';
const OP_REMAINING = 'eeeeeeee-1111-4111-8111-111111111111';
const OP_EXCESS = 'ffffffff-1111-4111-8111-111111111111';

function createInMemoryTrx(initialStock) {
  const returns = [];
  const inventory = new Map([['a-product', { document_id: 'a-product', available_quantity: initialStock }]]);

  const trx = (table) => {
    if (table === stock.RETURN_TABLE) {
      let filter = {};
      const builder = {
        where(criteria) {
          filter = { ...filter, ...criteria };
          return builder;
        },
        orderBy(column) {
          const rows = returns.filter((row) =>
            Object.entries(filter).every(([key, value]) => row[key] === value));
          return Promise.resolve([...rows].sort((a, b) => (a[column] < b[column] ? -1 : 1)));
        },
        sum(aliasMap) {
          const alias = Object.keys(aliasMap)[0];
          const column = aliasMap[alias];
          const sum = returns
            .filter((row) => Object.entries(filter).every(([key, value]) => row[key] === value))
            .reduce((acc, row) => acc + Number(row[column] || 0), 0);
          return Promise.resolve([{ [alias]: sum }]);
        },
        insert(rows) {
          returns.push(...rows);
          return Promise.resolve();
        },
      };
      return builder;
    }

    if (table === stock.INVENTORY_TABLE) {
      let filter = {};
      const builder = {
        where(criteria) {
          filter = { ...filter, ...criteria };
          return builder;
        },
        forUpdate() {
          return builder;
        },
        first() {
          return Promise.resolve(inventory.get(filter.document_id) || null);
        },
        update(patch) {
          const row = inventory.get(filter.document_id);
          if (row) {
            Object.assign(row, patch);
          }
          return Promise.resolve(1);
        },
      };
      return builder;
    }

    if (table === 'products') {
      return {
        where() {
          return this;
        },
        update() {
          return Promise.resolve(1);
        },
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  };

  trx.raw = async () => {};
  trx.__getInventory = (externalId) => inventory.get(externalId);
  return { trx, inventory, returns };
}

function createStrapiHarness(initialStock = 2) {
  const carts = [];
  const { trx, inventory } = createInMemoryTrx(initialStock);

  const strapi = {
    db: {
      metadata: {
        get: (uid) => (uid === 'api::product.product'
          ? {
            tableName: 'products',
            attributes: {
              documentId: { columnName: 'document_id' },
              stock: { columnName: 'stock' },
              isAvailable: { columnName: 'is_available' },
            },
          }
          : null),
      },
      transaction: async (callback) => callback({ trx }),
      query(uid) {
        if (uid === 'api::byemoney-cart.byemoney-cart') {
          return {
            findOne: async ({ where }) => carts.find((cart) => cart.cartId === where.cartId) || null,
            create: async ({ data }) => {
              const row = { id: carts.length + 1, ...data };
              carts.push(row);
              return row;
            },
            update: async ({ where, data }) => {
              const row = carts.find((cart) => cart.id === where.id);
              Object.assign(row, data);
              return row;
            },
          };
        }
        if (uid === 'api::shipping-setting.shipping-setting') {
          return {
            findOne: async () => ({
              costMode: 'fixed',
              fixedAmountInNoor: 10,
              freeShippingThresholdInNoor: 0,
              rialPerNoorForShipping: 1000,
            }),
          };
        }
        if (uid === 'api::city.city') {
          return { findOne: async () => ({ externalId: 1 }) };
        }
        if (uid === 'plugin::users-permissions.user') {
          return {
            findOne: async () => ({
              documentId: BUYER_ID,
              confirmed: true,
              blocked: false,
              is_foreigner: false,
              address: {
                postalCode: '1234567890',
                fullAddress: 'خیابان آزادی پلاک ۱۰',
                recipientName: 'علی',
                recipientPhone: '09120000000',
                cityLink: {
                  documentId: 'city-tehran',
                  name: 'تهران',
                  province: { name: 'تهران' },
                },
              },
            }),
          };
        }
        if (uid === 'api::course.course') {
          const parentCourse = {
            id: 2,
            documentId: 'parent-course',
            title: 'دوره فصل‌دار',
            isChaptered: true,
            publishedAt: '2026-01-01T00:00:00.000Z',
            chapters: [
              { integrationId: 'b-chapter', title: 'فصل', price: 100, discountPercent: 0 },
            ],
          };
          return {
            findOne: async ({ where }) => (where?.chapters?.integrationId === 'b-chapter' ? parentCourse : null),
            findMany: async () => [],
          };
        }
        return { findOne: async () => null, findMany: async () => [] };
      },
    },
    documents(uid) {
      if (uid === 'api::course.course') {
        return {
          findOne: async ({ documentId }) => (documentId === 'c-course'
            ? {
              id: 1,
              documentId: 'c-course',
              title: 'دوره',
              price: 200,
              discountPercent: 0,
              isChaptered: false,
              chapters: [],
              publishedAt: '2026-01-01T00:00:00.000Z',
            }
            : null),
        };
      }
      if (uid === 'api::product.product') {
        return {
          findOne: async ({ documentId }) => (documentId === 'a-product'
            ? {
              documentId: 'a-product',
              title: 'کتاب فیزیکی',
              price: 50,
              discountPercent: 0,
              isAvailable: true,
              stock: 5,
              weight: 250,
              boxTypeId: 5,
              isFragile: false,
              shippingOrigin: {
                originId: 'ramsar',
                displayName: 'انبار رامسر',
                city: { externalId: 10, name: 'رامسر' },
              },
            }
            : null),
        };
      }
      return { findOne: async () => null };
    },
  };

  return { strapi, carts, inventory };
}

describe('mixed cart commit and restock ordering when product.externalId < digital.externalId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('commits and restocks the exact physical item with partial, full, and idempotent retry', async () => {
    const { strapi, carts, inventory } = createStrapiHarness(2);

    const snapshot = await service.prepare(strapi, {
      cartId: CART_ID,
      buyerExternalUserId: BUYER_ID,
      items: [
        { externalId: 'a-product', type: 'product', quantity: 3 },
        { externalId: 'c-course', type: 'course', quantity: 1 },
        { externalId: 'b-chapter', type: 'course_chapter', quantity: 1 },
      ],
    });

    expect(snapshot.items.map((item) => `${item.type}:${item.externalId}`)).toEqual([
      'course:c-course',
      'course_chapter:b-chapter',
      'product:a-product',
    ]);

    const cart = carts[0];
    const purchaseIds = [PURCHASE_COURSE, PURCHASE_CHAPTER, PURCHASE_PRODUCT];
    await strapi.db.transaction(async ({ trx }) => {
      await service.transition(strapi, trx, cart, {
        buyerExternalUserId: BUYER_ID,
        purchaseIds,
      }, 'commit');
    });

    expect(confirmPurchase).toHaveBeenCalledTimes(2);
    expect(confirmPurchase).toHaveBeenNthCalledWith(1, expect.objectContaining({
      purchaseId: PURCHASE_COURSE,
      item: expect.objectContaining({ externalId: 'c-course', type: 'course' }),
    }), { strapiInstance: strapi });
    expect(confirmPurchase).toHaveBeenNthCalledWith(2, expect.objectContaining({
      purchaseId: PURCHASE_CHAPTER,
      item: expect.objectContaining({ externalId: 'b-chapter', type: 'course_chapter' }),
    }), { strapiInstance: strapi });

    // Partial restock of 1 unit
    const firstRestock = await service.restock(strapi, {
      cartId: CART_ID,
      operationId: OP_PARTIAL,
      items: [{ purchaseId: PURCHASE_PRODUCT, quantity: 1 }],
    });
    expect(firstRestock).toEqual({ success: true, restocked: true });
    expect(inventory.get('a-product').available_quantity).toBe(3);

    // Idempotent retry with the same operationId
    const retryRestock = await service.restock(strapi, {
      cartId: CART_ID,
      operationId: OP_PARTIAL,
      items: [{ purchaseId: PURCHASE_PRODUCT, quantity: 1 }],
    });
    expect(retryRestock).toEqual({ success: true, restocked: false });
    expect(inventory.get('a-product').available_quantity).toBe(3);

    // Restock remaining 2 units (total 3 of 3)
    const remainingRestock = await service.restock(strapi, {
      cartId: CART_ID,
      operationId: OP_REMAINING,
      items: [{ purchaseId: PURCHASE_PRODUCT, quantity: 2 }],
    });
    expect(remainingRestock).toEqual({ success: true, restocked: true });
    expect(inventory.get('a-product').available_quantity).toBe(5);

    // Exceeding purchased quantity fails with CART_CONFLICT
    await expect(service.restock(strapi, {
      cartId: CART_ID,
      operationId: OP_EXCESS,
      items: [{ purchaseId: PURCHASE_PRODUCT, quantity: 1 }],
    })).rejects.toMatchObject({ status: 409, code: 'CART_CONFLICT' });
  });
});

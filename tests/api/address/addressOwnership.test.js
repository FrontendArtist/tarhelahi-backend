'use strict';

const isAddressOwner = require('../../../src/api/address/policies/is-address-owner');

const mockSuperFind = jest.fn(async () => ({ data: [] }));
const mockSuperCreate = jest.fn(async () => ({ data: { id: 1 } }));
const mockSuperUpdate = jest.fn(async () => ({ data: { id: 1 } }));

jest.mock('@strapi/strapi', () => ({
  factories: {
    createCoreController: (_uid, customizer) => {
      const overrides = customizer({ strapi: {} });
      Object.setPrototypeOf(overrides, { find: mockSuperFind, create: mockSuperCreate, update: mockSuperUpdate });
      return overrides;
    },
  },
}));

const addressController = require('../../../src/api/address/controllers/address');

describe('address ownership policy & controller (HF17)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('is-address-owner policy', () => {
    const mockStrapi = {
      documents: jest.fn(() => ({
        findOne: jest.fn(async ({ documentId }) => {
          if (documentId === 'addr-42') return { id: 5, documentId: 'addr-42', user: { id: 42 } };
          if (documentId === 'addr-99') return { id: 6, documentId: 'addr-99', user: { id: 99 } };
          return null;
        }),
      })),
      db: {
        query: jest.fn(() => ({
          findOne: jest.fn(async ({ where }) => {
            if (where.id === 5) return { id: 5, user: { id: 42 } };
            return null;
          }),
        })),
      },
    };

    test('کاربر ناشناس را رد می‌کند', async () => {
      const allowed = await isAddressOwner({ state: {}, params: { id: 'addr-42' } }, {}, { strapi: mockStrapi });
      expect(allowed).toBe(false);
    });

    test('توکن سرویس api-token مجاز است', async () => {
      const allowed = await isAddressOwner(
        { state: { auth: { strategy: { name: 'api-token' } } }, params: { id: 'addr-99' } },
        {},
        { strapi: mockStrapi }
      );
      expect(allowed).toBe(true);
    });

    test('ادمین مجاز است', async () => {
      const allowed = await isAddressOwner(
        { state: { user: { id: 1, role: { type: 'administrator' } } }, params: { id: 'addr-99' } },
        {},
        { strapi: mockStrapi }
      );
      expect(allowed).toBe(true);
    });

    test('مالک آدرس مجاز است و کاربر غیرمالک رد می‌شود', async () => {
      const ownerAllowed = await isAddressOwner(
        { state: { user: { id: 42, role: { type: 'authenticated' } } }, params: { id: 'addr-42' } },
        {},
        { strapi: mockStrapi }
      );
      const otherAllowed = await isAddressOwner(
        { state: { user: { id: 42, role: { type: 'authenticated' } } }, params: { id: 'addr-99' } },
        {},
        { strapi: mockStrapi }
      );
      expect(ownerAllowed).toBe(true);
      expect(otherAllowed).toBe(false);
    });

    test('برای آدرس ناموجود اجازهٔ عبور به کنترلر می‌دهد تا 404 برگردد', async () => {
      const allowed = await isAddressOwner(
        { state: { user: { id: 42, role: { type: 'authenticated' } } }, params: { id: 'missing-id' } },
        {},
        { strapi: mockStrapi }
      );
      expect(allowed).toBe(true);
    });
  });

  describe('address controller scoping', () => {
    test('find فیلتر user را به کاربر جاری محدود می‌کند', async () => {
      const ctx = {
        state: { user: { id: 42, role: { type: 'authenticated' } } },
        query: { filters: { city: { $eq: 'تهران' } } },
      };
      await addressController.find(ctx);
      expect(ctx.query.filters.user).toEqual({ id: { $eq: 42 } });
      expect(ctx.query.filters.city).toEqual({ $eq: 'تهران' });
      expect(mockSuperFind).toHaveBeenCalledTimes(1);
    });

    test('create فیلد user را با شناسهٔ کاربر جاری بازنویسی می‌کند', async () => {
      const ctx = {
        state: { user: { id: 42, role: { type: 'authenticated' } } },
        request: { body: { data: { fullAddress: 'تهران', user: 999 } } },
      };
      await addressController.create(ctx);
      expect(ctx.request.body.data.user).toBe(42);
      expect(mockSuperCreate).toHaveBeenCalledTimes(1);
    });

    test('update فیلد user را از بدنهٔ کاربر عادی حذف می‌کند', async () => {
      const ctx = {
        state: { user: { id: 42, role: { type: 'authenticated' } } },
        request: { body: { data: { fullAddress: 'تهران جدید', user: 999 } } },
      };
      await addressController.update(ctx);
      expect(ctx.request.body.data).toEqual({ fullAddress: 'تهران جدید' });
      expect(mockSuperUpdate).toHaveBeenCalledTimes(1);
    });
  });
});

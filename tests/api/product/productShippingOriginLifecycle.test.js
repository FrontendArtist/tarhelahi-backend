'use strict';

const lifecycles = require('../../../src/api/product/content-types/product/lifecycles');

const EMPTY_ORIGIN_MESSAGE = 'مبدأ ارسال کالا نمی‌تواند خالی باشد.';
const shippingOrigins = require('../../../src/services/shippingOrigins');

function createStrapi(origin) {
  return {
    db: {
      query(uid) {
        if (uid !== shippingOrigins.UID) {
          throw new Error(`unexpected uid ${uid}`);
        }
        return {
          findOne: async ({ where, select } = {}) => {
            expect(select).toEqual(['id']);
            expect(where).toEqual({ originId: 'ramsar' });
            return origin;
          },
        };
      },
    },
  };
}

describe('product shipping origin lifecycle', () => {
  const previous = global.strapi;

  afterEach(() => {
    global.strapi = previous;
  });

  it('defaults a new product to ramsar when shippingOrigin is omitted', async () => {
    global.strapi = createStrapi({ id: 41 });
    const data = { title: 'کالا' };

    await lifecycles.beforeCreate({ params: { data } });

    expect(data.shippingOrigin).toEqual({ set: [{ id: 41 }] });
  });

  it('keeps an explicit origin chosen on create', async () => {
    global.strapi = createStrapi(null);
    const data = { title: 'کالا', shippingOrigin: { connect: [{ id: 9 }] } };

    await lifecycles.beforeCreate({ params: { data } });

    expect(data.shippingOrigin).toEqual({ connect: [{ id: 9 }] });
  });

  it('rejects clearing shippingOrigin on update', async () => {
    global.strapi = createStrapi({ id: 41 });
    const data = { shippingOrigin: null };

    await expect(lifecycles.beforeUpdate({ params: { data } })).rejects.toMatchObject({
      message: EMPTY_ORIGIN_MESSAGE,
    });
    expect(data.shippingOrigin).toBeNull();
  });

  it('defaults when the admin create form sends an empty relation diff', async () => {
    global.strapi = createStrapi({ id: 41 });
    const data = { title: 'کالا', shippingOrigin: { connect: [], disconnect: [] } };

    await lifecycles.beforeCreate({ params: { data } });

    expect(data.shippingOrigin).toEqual({ set: [{ id: 41 }] });
  });

  it('keeps an untouched relation diff on update', async () => {
    global.strapi = createStrapi({ id: 41 });
    const data = { title: 'نام تازه', shippingOrigin: { connect: [], disconnect: [] } };

    await lifecycles.beforeUpdate({ params: { data } });

    expect(data).toEqual({ title: 'نام تازه', shippingOrigin: { connect: [], disconnect: [] } });
  });

  it('rejects disconnecting the origin without a replacement', async () => {
    global.strapi = createStrapi({ id: 41 });

    await expect(lifecycles.beforeUpdate({
      params: { data: { shippingOrigin: { connect: [], disconnect: [{ id: 41 }] } } },
    })).rejects.toMatchObject({
      message: EMPTY_ORIGIN_MESSAGE,
    });
  });

  it('rejects an empty relation update and leaves other updates alone', async () => {
    global.strapi = createStrapi({ id: 41 });
    await expect(lifecycles.beforeUpdate({
      params: { data: { shippingOrigin: { set: [] } } },
    })).rejects.toMatchObject({
      message: EMPTY_ORIGIN_MESSAGE,
    });

    const untouched = { title: 'نام تازه' };
    await lifecycles.beforeUpdate({ params: { data: untouched } });
    expect(untouched).toEqual({ title: 'نام تازه' });
  });

  it('allows changing the origin to another warehouse', async () => {
    global.strapi = createStrapi(null);
    const data = { shippingOrigin: { set: [{ id: 12 }] } };

    await lifecycles.beforeUpdate({ params: { data } });

    expect(data.shippingOrigin).toEqual({ set: [{ id: 12 }] });
  });
});

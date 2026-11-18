'use strict';

const { addressOf } = require('../../src/services/physicalCartQuote');

const product = { externalId: 'p1', type: 'product', quantity: 1 };

function buyer(address) {
  return { is_foreigner: false, address };
}

describe('physical address snapshot', () => {
  it('freezes our city id and the names from the linked row', () => {
    const result = addressOf(buyer({
      province: 'نام کهنه',
      city: 'شهر کهنه',
      postalCode: '1234567890',
      fullAddress: 'خیابان ساحلی',
      recipientName: 'مریم',
      recipientPhone: '09120000000',
      cityLink: {
        documentId: ' city-ramsar ',
        name: ' رامسر ',
        externalId: 573,
        province: { name: ' مازندران ' },
      },
    }), [product]);

    expect(result.addressSnapshot).toEqual({
      province: 'مازندران',
      city: 'رامسر',
      cityDocumentId: 'city-ramsar',
      postalCode: '1234567890',
      fullAddress: 'خیابان ساحلی',
      recipientName: 'مریم',
      recipientPhone: '09120000000',
    });
    expect(result.addressSnapshot.externalId).toBeUndefined();
    expect(result.addressVersion).toEqual(expect.any(String));
  });

  it('rejects a street address shorter than ten characters', () => {
    expect(() => addressOf(buyer({
      postalCode: '1234567890',
      fullAddress: 'مشهد',
      recipientName: 'مریم',
      recipientPhone: '09120000000',
      cityLink: {
        documentId: 'city-ramsar',
        name: 'رامسر',
        province: { name: 'مازندران' },
      },
    }), [product])).toThrow('نشانی باید حداقل ۱۰ نویسه باشد (خیابان، کوچه و پلاک).');
  });

  it('rejects a physical cart whose address is not linked to our city table', () => {
    expect(() => addressOf(buyer({
      province: 'مازندران',
      city: 'رامسر',
      postalCode: '1234567890',
      fullAddress: 'خیابان ساحلی',
      recipientName: 'مریم',
      recipientPhone: '09120000000',
    }), [product], true)).toThrow('شهر آدرس باید از فهرست شهرها انتخاب شود.');
  });

  it('does not require a city for a cart without physical items', () => {
    expect(addressOf(buyer(null), [{ type: 'course', externalId: 'c1', quantity: 1 }])).toEqual({
      addressSnapshot: null,
      addressVersion: null,
    });
  });
});

'use strict';

const postexBoxes = require('../../src/services/postexBoxes');

describe('postexBoxes', () => {
  it('resolves ids 1..12 and rejects 13', () => {
    expect(postexBoxes.resolve(5)).toMatchObject({
      id: 5,
      name: 'جعبه سایز 2',
      lengthCm: 15,
      widthCm: 10,
      heightCm: 20,
    });
    expect(postexBoxes.resolve('box7: جعبه سایز 4 (20×20×30)')).toMatchObject({ id: 7, lengthCm: 20 });
    expect(postexBoxes.resolve(13)).toBeNull();
    expect(postexBoxes.resolve(null)).toBeNull();
    expect(postexBoxes.enumerationValues()).toHaveLength(12);
  });

  it('chooses the shipment box from the cart rule', () => {
    expect(postexBoxes.shipmentBoxTypeId(7, 1)).toBe(7);
    expect(postexBoxes.shipmentBoxTypeId(7, 2)).toBe(8);
    expect(postexBoxes.shipmentBoxTypeId(12, 4)).toBe(12);
    expect(postexBoxes.shipmentBoxTypeId(11, 2)).toBe(12);
    expect(postexBoxes.shipmentBoxTypeId(1, 3)).toBe(1);
    expect(postexBoxes.shipmentBoxTypeId(2, 2)).toBe(2);
    expect(postexBoxes.shipmentBoxTypeId(3, 5)).toBe(3);
    expect(postexBoxes.shipmentBoxTypeId(7, 4, 7)).toBe(7);
    expect(postexBoxes.shipmentBoxTypeId(7, 4, 13)).toBeNull();
  });
});

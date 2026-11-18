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
});

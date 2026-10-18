'use strict';
const factory = require('../../src/api/coupon/services/coupon');
const { allocateDiscount } = require('../../src/services/coupon-allocation');
function service(overrides = {}) {
  const coupon = { documentId: 'coupon', code: 'CART', isActive: true, discountType: 'percentage',
    discountValue: 10, appliesToAllCourses: true, ...overrides };
  return factory({ strapi: { contentType: () => ({}), documents: () => ({ findMany: async () => [coupon] }) } });
}
const items = [
  { id: 1, documentId: 'course-a', type: 'course', price: 105, quantity: 1 },
  { id: 2, documentId: 'course-b', type: 'course', price: 105, quantity: 1 },
];
test('کوپن عمومی روی جمع سبد ۲۱ نور کم می‌کند، نه ۲۰ نور', async () => {
  const result = await service().validateAndCalculate('CART', items, 0);
  expect(result.discountAmount).toBe(21);
  expect(result.finalTotalPrice).toBe(189);
  expect(result.itemDiscounts.reduce((s, row) => s + row.discountAmount, 0)).toBe(21);
});
test('کوپن اختصاصی فقط دورهٔ انتخاب‌شده را کاهش می‌دهد', async () => {
  const result = await service({ appliesToAllCourses: false, courses: [{ documentId: 'course-a' }] }).validateAndCalculate('CART', items);
  expect(result.discountAmount).toBe(10);
  expect(result.finalTotalPrice).toBe(200);
  expect(result.itemDiscounts).toEqual([{ id: 1, discountAmount: 10 }]);
});
test('کوپن اختصاصی چند دوره همچنان ردیفی گرد می‌شود', async () => {
  const result = await service({ appliesToAllCourses: false, courses: [{ documentId: 'course-a' }, { documentId: 'course-b' }] }).validateAndCalculate('CART', items);
  expect(result.discountAmount).toBe(20);
});
test.each([
  [{ maxDiscountAmount: 15 }, 15, 195],
  [{ discountType: 'fixed', discountValue: 21 }, 21, 189],
  [{ discountValue: 100 }, 210, 0],
  [{ discountType: 'fixed', discountValue: 999 }, 210, 0],
])('سقف و کوپن ثابت و رایگان جمع را حفظ می‌کنند: %j', async (coupon, discount, total) => {
  const result = await service(coupon).validateAndCalculate('CART', items);
  expect(result.discountAmount).toBe(discount);
  expect(result.finalTotalPrice).toBe(total);
  expect(result.itemDiscounts.reduce((s, row) => s + row.discountAmount, 0)).toBe(discount);
});
test('اقلام غیرمشمول و شارژ نور تخفیف نمی‌گیرند', async () => {
  const result = await service({ appliesToAllProducts: true }).validateAndCalculate('CART', [
    ...items, { id: 3, type: 'light_topup', price: 1000 },
  ]);
  expect(result.discountAmount).toBe(21);
  expect(result.eligibleItemIds).not.toContain(3);
});
test('تخصیص تخفیف از قیمت ردیف تجاوز نمی‌کند و نور گم نمی‌شود', () => {
  for (let first = 0; first < 30; first++) for (let second = 0; second < 30; second++) {
    const amount = Math.floor((first + second) * .37);
    const shares = allocateDiscount([{ id: 1, total: first }, { id: 2, total: second }], amount);
    expect([...shares.values()].reduce((a, b) => a + b, 0)).toBe(amount);
    expect(shares.get(1)).toBeLessThanOrEqual(first);
    expect(shares.get(2)).toBeLessThanOrEqual(second);
  }
});

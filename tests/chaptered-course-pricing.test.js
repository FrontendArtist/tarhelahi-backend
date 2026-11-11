'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateChapteredCoursePrice,
  createAlreadyOwnedError,
} = require('../src/services/chapteredCoursePricing');

const sampleCourse = {
  id: 10,
  documentId: 'doc-course-10',
  title: 'دوره جامع هفت چاکرا',
  isChaptered: true,
  price: 5000000,
  discountPercent: 50,
  discountUntil: null,
  chapters: [
    { id: 1, integrationId: 'uuid-ch-1', title: 'فصل ۱', price: 1000000 },
    { id: 2, integrationId: 'uuid-ch-2', title: 'فصل ۲', price: 1000000 },
    { id: 3, integrationId: 'uuid-ch-3', title: 'فصل ۳', price: 1000000 },
    { id: 4, integrationId: 'uuid-ch-4', title: 'فصل ۴', price: 1000000 },
    { id: 5, integrationId: 'uuid-ch-5', title: 'فصل ۵', price: 1000000 },
  ],
};

test('کاربر هیچ فصلی نخریده باشد: قیمت کامل پکیج با تخفیف ۵۰٪ محاسبه می‌شود', () => {
  const result = calculateChapteredCoursePrice({
    course: sampleCourse,
    userEnrolledChapterIds: [],
    userEnrolledChapterUuids: [],
  });
  assert.equal(result.isFullyOwned, false);
  assert.equal(result.unownedCount, 5);
  // ۵ میلیون با ۵۰٪ تخفیف = ۲.۵ میلیون
  assert.equal(result.price, 2500000);
});

test('کاربر تمام فصل‌ها را خریده باشد: isFullyOwned فعال و قیمت صفر است', () => {
  const result = calculateChapteredCoursePrice({
    course: sampleCourse,
    userEnrolledChapterIds: [1, 2, 3, 4, 5],
  });
  assert.equal(result.isFullyOwned, true);
  assert.equal(result.unownedCount, 0);
  assert.equal(result.price, 0);
});

test('اگر ۱ فصل باقی مانده باشد، تخفیف دوره روی همان فصل اعمال می‌شود', () => {
  // کاربر ۴ فصل از ۵ فصل را دارد (فقط فصل ۵ مانده با قیمت ۱,۰۰۰,۰۰۰)
  const result = calculateChapteredCoursePrice({
    course: sampleCourse,
    userEnrolledChapterIds: [1, 2, 3, 4],
  });
  assert.equal(result.isFullyOwned, false);
  assert.equal(result.unownedCount, 1);
  assert.equal(result.remainingBasePrice, 1000000);
  // تخفیف ۵۰٪ دوره روی ۱ میلیون فصل باقیمانده اعمال می‌شود -> ۵۰۰,۰۰۰ تومان
  assert.equal(result.price, 500000);
  assert.equal(result.appliedDiscountPercent, 50);
});

test('اگر ۲ فصل یا بیشتر باقی مانده باشد، تخفیف دوره روی جمع فصل‌های باقیمانده اعمال می‌شود', () => {
  // کاربر ۲ فصل خریده و ۳ فصل مانده (جمع قیمت فصل‌های مانده = ۳,۰۰۰,۰۰۰)
  // با ۵۰٪ تخفیف دوره = ۱,۵۰۰,۰۰۰ تومان (نه اینکه صفر یا منفی شود)
  const result = calculateChapteredCoursePrice({
    course: sampleCourse,
    userEnrolledChapterIds: [1, 2],
  });
  assert.equal(result.isFullyOwned, false);
  assert.equal(result.unownedCount, 3);
  assert.equal(result.remainingBasePrice, 3000000);
  assert.equal(result.price, 1500000);
  assert.equal(result.appliedDiscountPercent, 50);
});

test('شناسایی فصل با UUID پایدار (integrationId)', () => {
  // کاربر فصل‌های ۱ و ۲ را با UUID خریده است
  const result = calculateChapteredCoursePrice({
    course: sampleCourse,
    userEnrolledChapterIds: [],
    userEnrolledChapterUuids: ['uuid-ch-1', 'uuid-ch-2'],
  });
  assert.equal(result.unownedCount, 3);
  assert.equal(result.price, 1500000);
});

test('کاربر خارجی: تسهیم نسبتی بر مبنای قیمت بین‌المللی', () => {
  const intlCourse = {
    ...sampleCourse,
    internationalPrice: 100, // 100 دلار
  };
  // ۳ فصل از ۵ فصل مانده
  const result = calculateChapteredCoursePrice({
    course: intlCourse,
    userEnrolledChapterIds: [1, 2],
    isForeign: true,
  });
  assert.equal(result.unownedCount, 3);
  // ۱۰۰ * (۳ / ۵) = ۶۰ دلار
  assert.equal(result.price, 60);

  // حالت ۱ فصل مانده برای خارجی
  const resultSingle = calculateChapteredCoursePrice({
    course: intlCourse,
    userEnrolledChapterIds: [1, 2, 3, 4],
    isForeign: true,
  });
  assert.equal(resultSingle.unownedCount, 1);
  // ۱۰۰ / ۵ = ۲۰ دلار
  assert.equal(resultSingle.price, 20);
});

test('انقضای تخفیف: در صورت سپری شدن تاریخ discountUntil، تخفیف اعمال نمی‌شود', () => {
  const expiredCourse = {
    ...sampleCourse,
    discountUntil: new Date(Date.now() - 100000).toISOString(),
  };
  // ۳ فصل مانده (۳ میلیون)
  const result = calculateChapteredCoursePrice({
    course: expiredCourse,
    userEnrolledChapterIds: [1, 2],
  });
  assert.equal(result.price, 3000000);
  assert.equal(result.appliedDiscountPercent, 0);
});

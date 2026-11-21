'use strict';

/**
 * جعبه‌های استاندارد پستکس (Postex_API.md بند ۹.۴)، بدون جعبهٔ ۱۳.
 * منبع واحد ابعاد کالا؛ شناسه در استعلام/prepare و ابعاد از همین جدول می‌آید.
 */

const BOXES = Object.freeze([
  Object.freeze({ id: 1, name: 'پاکت نامه A5', lengthCm: 22, widthCm: 11, heightCm: 2 }),
  Object.freeze({ id: 2, name: 'پاکت نامه A4', lengthCm: 31, widthCm: 22, heightCm: 2 }),
  Object.freeze({ id: 3, name: 'پاکت نامه A3', lengthCm: 45, widthCm: 30, heightCm: 2 }),
  Object.freeze({ id: 4, name: 'جعبه سایز 1', lengthCm: 10, widthCm: 10, heightCm: 15 }),
  Object.freeze({ id: 5, name: 'جعبه سایز 2', lengthCm: 15, widthCm: 10, heightCm: 20 }),
  Object.freeze({ id: 6, name: 'جعبه سایز 3', lengthCm: 20, widthCm: 15, heightCm: 20 }),
  Object.freeze({ id: 7, name: 'جعبه سایز 4', lengthCm: 20, widthCm: 20, heightCm: 30 }),
  Object.freeze({ id: 8, name: 'جعبه سایز 5', lengthCm: 25, widthCm: 25, heightCm: 35 }),
  Object.freeze({ id: 9, name: 'جعبه سایز 6', lengthCm: 25, widthCm: 20, heightCm: 45 }),
  Object.freeze({ id: 10, name: 'جعبه سایز 7', lengthCm: 30, widthCm: 25, heightCm: 40 }),
  Object.freeze({ id: 11, name: 'جعبه سایز 8', lengthCm: 40, widthCm: 30, heightCm: 45 }),
  Object.freeze({ id: 12, name: 'جعبه سایز 9', lengthCm: 45, widthCm: 35, heightCm: 50 }),
]);

const BY_ID = new Map(BOXES.map((box) => [box.id, box]));

/**
 * مقادیر enumeration استرپی: باید با حرف شروع شوند (قید استرپی)، بعد شناسه و برچسب.
 * نمونه: box5: جعبه سایز 2 (15×10×20)
 */
function enumerationValue(box) {
  return `box${box.id}: ${box.name} (${box.lengthCm}×${box.widthCm}×${box.heightCm})`;
}

function enumerationValues() {
  return BOXES.map(enumerationValue);
}

/**
 * شناسهٔ عددی ۱…۱۲ از مقدار فیلد کالا (عدد یا رشتهٔ enum با پیشوند box).
 * @returns {number|null}
 */
function parseBoxTypeId(value) {
  if (value == null || value === '') {
    return null;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return BY_ID.has(value) ? value : null;
  }
  const text = String(value).trim();
  const match = text.match(/^box(\d+)/i) || text.match(/^(\d+)/);
  if (!match) {
    return null;
  }
  const id = Number(match[1]);
  return BY_ID.has(id) ? id : null;
}

/** @returns {{ id: number, name: string, lengthCm: number, widthCm: number, heightCm: number }|null} */
function resolve(value) {
  const id = parseBoxTypeId(value);
  return id == null ? null : BY_ID.get(id);
}

/**
 * جعبهٔ مرسولهٔ تجمیعی سبد.
 * پایه بزرگ‌ترین شناسهٔ اقلام است. شناسهٔ ۴ تا ۱۱ با بیش از یک واحد کالا یک پله بزرگ می‌شود
 * و از ۱۲ بالاتر نمی‌رود. پاکت‌های ۱ تا ۳ افزایش نمی‌گیرند. شناسهٔ ۱۳ استفاده نمی‌شود.
 * اگر شناسهٔ دستی معتبر باشد، همان بدون افزایش برمی‌گردد.
 * @returns {number|null}
 */
function shipmentBoxTypeId(baseBoxTypeId, unitCount, manualBoxTypeId) {
  if (manualBoxTypeId != null && manualBoxTypeId !== '') {
    return parseBoxTypeId(manualBoxTypeId);
  }
  const base = parseBoxTypeId(baseBoxTypeId);
  if (base == null) {
    return null;
  }
  const units = Number(unitCount);
  if (base >= 4 && base <= 11 && Number.isSafeInteger(units) && units > 1) {
    return base + 1;
  }
  return base;
}

module.exports = {
  BOXES,
  enumerationValue,
  enumerationValues,
  parseBoxTypeId,
  resolve,
  shipmentBoxTypeId,
};

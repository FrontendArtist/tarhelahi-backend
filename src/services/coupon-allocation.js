'use strict';

// سهم ردیف‌ها فقط برای ثبت سفارش است؛ جمع تخفیف عمومی پیش‌تر تعیین شده است.
function allocateDiscount(rows, amount) {
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const target = Math.min(Math.floor(amount), Math.floor(total));
  if (total <= 0) return new Map(rows.map(row => [row.id, 0]));
  const shares = rows.map((row, index) => {
    const exact = target * row.total / total;
    return { ...row, index, amount: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remaining = target - shares.reduce((sum, row) => sum + row.amount, 0);
  for (const row of [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (remaining > 0 && row.amount < row.total) { row.amount++; remaining--; }
  }
  return new Map(shares.map(row => [row.id, row.amount]));
}

module.exports = { allocateDiscount };

'use strict';

const EVENT = 'api::gateway-payment-event.gateway-payment-event';

const RESULT_DESCRIPTIONS = new Map([
  ['-2', 'تراکنش یافت نشد.'],
  ['-6', 'بیش از نیم ساعت از زمان اجرای تراکنش گذشته است.'],
  ['0', 'موفق'],
  ['-106', 'آدرس IP درخواست‌دهنده مجاز نیست.'],
  ['-104', 'ترمینال ارسالی غیرفعال است.'],
  ['-105', 'ترمینال ارسالی در سیستم وجود ندارد.'],
  ['2', 'درخواست تکراری است.'],
  ['5', 'تراکنش برگشت خورده است.'],
]);

const CALLBACK_DESCRIPTIONS = new Map([
  ['2', 'پرداخت با موفقیت انجام شد.'],
]);

// آخرین کد ثبت‌شدهٔ هر پرونده با یک خواندن گروهی برای صفحهٔ فهرست دریافت می‌شود.
async function getBankResults(strapi, references) {
  const results = new Map();
  if (references.length === 0) return results;

  const events = await strapi.db.query(EVENT).findMany({
    where: { resNum: { $in: references }, bankResultCode: { $notNull: true } },
    select: ['resNum', 'bankResultCode', 'stage'],
    orderBy: [{ occurredAtUtc: 'desc' }, { id: 'desc' }],
  });

  for (const event of events) {
    if (event.bankResultCode == null || event.bankResultCode === '' || results.has(event.resNum)) continue;
    const code = String(event.bankResultCode);
    const descriptions = event.stage === 'callback' ? CALLBACK_DESCRIPTIONS :
      ['verify', 'reverse'].includes(event.stage) ? RESULT_DESCRIPTIONS : null;
    results.set(event.resNum, {
      bankResultCode: code,
      bankResultStage: event.stage,
      bankResultDescription: descriptions?.get(code) || null,
    });
  }

  return results;
}

module.exports = { getBankResults };

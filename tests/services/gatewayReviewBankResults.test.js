'use strict';
const { getBankResults } = require('../../src/services/gatewayReviewBankResults');

test('کد یکسان کال‌بک با نتیجه Verify اشتباه گرفته نمی‌شود', async () => {
  const events = [
    { resNum: 'callback', stage: 'callback', bankResultCode: '2' },
    { resNum: 'verify', stage: 'verify', bankResultCode: '2' },
    { resNum: 'reverse', stage: 'reverse', bankResultCode: '5' },
    { resNum: 'unknown', stage: 'callback', bankResultCode: '-6' },
  ];
  const strapi = { db: { query: () => ({ findMany: async () => events }) } };
  const result = await getBankResults(strapi, events.map(event => event.resNum));
  expect(result.get('callback')).toEqual({ bankResultCode: '2', bankResultStage: 'callback',
    bankResultDescription: 'پرداخت با موفقیت انجام شد.' });
  expect(result.get('verify').bankResultDescription).toBe('درخواست تکراری است.');
  expect(result.get('reverse').bankResultDescription).toBe('تراکنش برگشت خورده است.');
  expect(result.get('unknown').bankResultDescription).toBeNull();
});

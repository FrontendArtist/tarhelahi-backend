// F:\tarhelahi\backend\src\services\smsService.js
//
// سرویس ارسال پیامک از طریق SMS.ir (نسخه جدید V2)
// استفاده از پکیج رسمی smsir-js با پشتیبانی از ارسال سریع کد تأیید (Verify) بر اساس قالب
//
'use strict';

const { Smsir } = require('smsir-js');

// ─────────────────────────────────────────────────────────────────────────────
// تنظیمات محیطی SMS.ir
// ─────────────────────────────────────────────────────────────────────────────
const apiKey = process.env.SMSIR_API_KEY;
const templateId = Number(process.env.SMSIR_TEMPLATE_ID) || 852164;
const lineNumber = process.env.SMSIR_LINE_NUMBER ? Number(process.env.SMSIR_LINE_NUMBER) : null;

/**
 * ایجاد کلاینت SMS.ir
 */
let smsirClient = null;

if (apiKey) {
  smsirClient = new Smsir(apiKey, lineNumber);
  console.log('[SMS Service] SMS.ir client initialized successfully.');
} else {
  console.warn('[SMS Service] SMSIR_API_KEY is not set. Running in MOCK mode.');
}

// ─────────────────────────────────────────────────────────────────────────────
// تابع کمکی برای حالت Mock (توسعه محلی بدون اتصال واقعی)
// ─────────────────────────────────────────────────────────────────────────────
function mockFallback(label, receptor, extra = {}) {
  const logFn = (typeof strapi !== 'undefined' && strapi.log)
    ? strapi.log.warn.bind(strapi.log)
    : console.warn;

  logFn(`[SMS Mock] ${label} → receptor: ${receptor} | data: ${JSON.stringify(extra)}`);
  return { success: true, mocked: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// sendOtp
// ─────────────────────────────────────────────────────────────────────────────
/**
 * ارسال کد یکبار مصرف (OTP) با قالب تایید هویت SMS.ir (ارسال سریع - بدون فیلتر بلک‌لیست)
 *
 * @param {string} receptor  - شماره موبایل گیرنده (مثال: 09019028765)
 * @param {string} token     - کد یکبار مصرف
 * @param {string} paramName - نام متغیر در قالب (پیش‌فرض: CODE)
 * @returns {Promise<{success: boolean, mocked?: boolean, result?: any}>}
 */
async function sendOtp(receptor, token, paramName = 'CODE') {
  // حالت Mock
  if (!smsirClient) {
    return mockFallback('sendOtp', receptor, { token, templateId, paramName });
  }

  try {
    // پارامترهای قالب تایید هویت sms.ir
    const parameters = [
      {
        name: paramName,
        value: String(token),
      },
    ];

    const response = await smsirClient.SendVerifyCode(receptor, templateId, parameters);

    if (response && response.data && (response.data.status === 1 || response.status === 200)) {
      return { success: true, result: response.data };
    } else {
      const errMsg = `[SMS Service] SendVerifyCode returned status ${response?.data?.status}: ${response?.data?.message || 'Unknown error'}`;
      throw new Error(errMsg);
    }
  } catch (error) {
    const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
    const logFn = (typeof strapi !== 'undefined' && strapi.log)
      ? strapi.log.error.bind(strapi.log)
      : console.error;

    logFn(`[SMS Service] Failed to send OTP via SMS.ir to ${receptor}: ${errorDetails}`);
    throw new Error(`SMS.ir verify error: ${errorDetails}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// sendDirectSms (ارسال پیام متنی عادی با خط اختصاصی)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * ارسال پیامک متنی آزاد
 *
 * @param {string} receptor  - شماره موبایل گیرنده
 * @param {string} message   - متن پیام
 * @returns {Promise<{success: boolean, mocked?: boolean, result?: any}>}
 */
async function sendDirectSms(receptor, message) {
  if (!smsirClient) {
    return mockFallback('sendDirectSms', receptor, { message, lineNumber });
  }

  try {
    const response = await smsirClient.SendBulk(message, [receptor], null, lineNumber);
    if (response && response.data && (response.data.status === 1 || response.status === 200)) {
      return { success: true, result: response.data };
    } else {
      throw new Error(`[SMS Service] SendBulk error: ${response?.data?.message}`);
    }
  } catch (error) {
    const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
    throw new Error(`SMS.ir direct send error: ${errorDetails}`);
  }
}

module.exports = {
  sendOtp,
  sendDirectSms,
};

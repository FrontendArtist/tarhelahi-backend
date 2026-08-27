// test-sms.js — تست دقیق سرعت و زمان پاسخگویی اتصال به SMS.ir
'use strict';

require('dotenv').config();

global.strapi = {
  log: {
    warn: (...args) => console.warn('[STRAPI WARN]', ...args),
    error: (...args) => console.error('[STRAPI ERROR]', ...args),
    info: (...args) => console.info('[STRAPI INFO]', ...args),
  },
};

const smsService = require('./src/services/smsService');

const RECEPTOR = '09019028765';
const OTP_CODE = Math.floor(100000 + Math.random() * 900000).toString();

async function runBenchmarkTest() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('⏱️   تست دقیق سرعت ارسال درخواست به وب‌سرویس SMS.ir');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`📱 گیرنده      : ${RECEPTOR}`);
  console.log(`🔑 کد ارسالی   : ${OTP_CODE}`);
  console.log(`📋 شناسه قالب  : ${process.env.SMSIR_TEMPLATE_ID || 852164}`);
  console.log('───────────────────────────────────────────────────────────');

  const startTime = performance.now();
  const requestSentAt = new Date().toISOString();

  console.log(`🚀 زمان ارسال درخواست از سیستم: ${requestSentAt}`);

  try {
    const result = await smsService.sendOtp(RECEPTOR, OTP_CODE);
    const endTime = performance.now();
    const durationMs = (endTime - startTime).toFixed(2);
    const durationSec = (durationMs / 1000).toFixed(2);

    console.log('\n✅ نتیجه دریافت پاسخ از سرور SMS.ir:');
    console.log(`   ├─ شناسه پیام (Message ID) : ${result?.result?.data?.messageId}`);
    console.log(`   ├─ وضعیت بازگشتی           : ${result?.result?.status} (${result?.result?.message})`);
    console.log(`   ├─ زمان دقیق رفت و برگشت   : ${durationMs} میلی‌ثانیه (${durationSec} ثانیه)`);
    console.log(`   └─ ساعت ثبت در SMS.ir       : ${new Date().toISOString()}`);

    console.log('\n───────────────────────────────────────────────────────────');
    console.log(`🎯 تحلیل:`);
    if (durationMs < 1000) {
      console.log(`⚡ سرعت فوق‌العاده بالاست! سرور ما در کمتر از ۱ ثانیه (${durationMs}ms) پیام را تحویل SMS.ir داد.`);
    } else {
      console.log(`⏱️ زمان تحویل به SMS.ir برابر ${durationSec} ثانیه بود.`);
    }
    console.log(`⚠️  اگر پیامک دیر به دست گوشی می‌رسد، کل این تاخیر بین SMS.ir و دکل مخابراتی است.`);
  } catch (err) {
    const endTime = performance.now();
    console.error(`\n❌ خطا در ارسال درخواست (${(endTime - startTime).toFixed(2)}ms):`);
    console.error('   ', err.message);
  }

  console.log('═══════════════════════════════════════════════════════════\n');
}

runBenchmarkTest();

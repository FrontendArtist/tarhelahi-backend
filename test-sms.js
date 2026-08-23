// test-sms.js — تست مستقل سرویس SMS.ir (بدون نیاز به Strapi یا فرانت)
'use strict';

require('dotenv').config();

// شبیه‌سازی strapi.log
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

async function runTest() {
  console.log('─────────────────────────────────────────────');
  console.log('🧪  SMS.ir OTP Verification Test');
  console.log('─────────────────────────────────────────────');
  console.log(`📱  Receptor    : ${RECEPTOR}`);
  console.log(`🔑  OTP Code    : ${OTP_CODE}`);
  console.log(`📋  Template ID : ${process.env.SMSIR_TEMPLATE_ID || 852164}`);
  console.log(`🔐  API Key     : ${process.env.SMSIR_API_KEY ? '✅ Present' : '❌ Missing (Mock mode)'}`);
  console.log('─────────────────────────────────────────────');

  try {
    console.log('\n⏳  Sending OTP via SMS.ir SendVerifyCode...\n');
    const result = await smsService.sendOtp(RECEPTOR, OTP_CODE);

    if (result.mocked) {
      console.log('⚠️  Result: MOCKED');
    } else {
      console.log('✅  Result: SUCCESS — SMS sent via SMS.ir!');
      console.log('   →', JSON.stringify(result.result, null, 2));
    }
  } catch (err) {
    console.error('\n❌  SMS send FAILED:');
    console.error('   ', err.message);
  }

  console.log('\n─────────────────────────────────────────────');
}

runTest();

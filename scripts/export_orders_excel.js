'use strict';

const { createStrapi } = require('@strapi/strapi');
const path = require('path');

async function main() {
  let app = null;
  try {
    console.log('⏳ Starting Strapi instance to export Excel report...');
    app = await createStrapi({ distDir: path.resolve(__dirname, '..') }).load();

    const excelService = require('../src/api/order/services/excel-export');

    console.log('📊 Fetching all orders & computing revenue metrics...');
    const result = await excelService.generateAndSaveExcelReport();

    console.log('====================================================');
    console.log('✅ گزارش اکسل سفارشات و درآمد با موفقیت تولید شد:');
    console.log(`📂 مسیر ذخیره فایل: ${result.filePath}`);
    console.log(`📦 تعداد کل سفارشات بررسی شده: ${result.ordersCount}`);
    console.log(`💰 درآمد کل فروشگاه: ${result.stats.metrics.totalRevenue.toLocaleString('fa-IR')} تومان`);
    console.log(`☀️ درآمد امروز: ${result.stats.metrics.todayRevenue.toLocaleString('fa-IR')} تومان`);
    console.log(`📆 درآمد دیروز: ${result.stats.metrics.yesterdayRevenue.toLocaleString('fa-IR')} تومان`);
    console.log(`📅 درآمد ۷ روز اخیر (هفتگی): ${result.stats.metrics.weeklyRevenue.toLocaleString('fa-IR')} تومان`);
    console.log(`🗓️ درآمد ۳۰ روز اخیر (ماهانه): ${result.stats.metrics.monthlyRevenue.toLocaleString('fa-IR')} تومان`);
    console.log(`🌙 درآمد ماه جاری خورشیدی: ${result.stats.metrics.currentPersianMonthRevenue.toLocaleString('fa-IR')} تومان`);
    console.log('====================================================');
  } catch (err) {
    console.error('❌ خطا در ایجاد فایل اکسل:', err.message || err);
  } finally {
    if (app) {
      await app.destroy();
    }
    process.exit(0);
  }
}

main();

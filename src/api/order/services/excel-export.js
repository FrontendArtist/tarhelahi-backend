'use strict';

const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

/**
 * Persian Months names mapping
 */
const PERSIAN_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد',
  'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر',
  'دی', 'بهمن', 'اسفند'
];

const PERSIAN_WEEKDAYS = [
  'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه', 'شنبه'
];

/**
 * Format a Date object into detailed Persian date components
 */
function getPersianDateDetails(dateInput) {
  if (!dateInput) {
    return {
      dateStr: '-',
      timeStr: '-',
      fullStr: '-',
      ymKey: '-',
      year: null,
      month: null,
      day: null,
      monthName: '-',
      weekdayName: '-',
      gregorianStr: '-',
      timestamp: 0,
    };
  }

  const d = new Date(dateInput);
  if (isNaN(d.getTime())) {
    return {
      dateStr: '-',
      timeStr: '-',
      fullStr: '-',
      ymKey: '-',
      year: null,
      month: null,
      day: null,
      monthName: '-',
      weekdayName: '-',
      gregorianStr: '-',
      timestamp: 0,
    };
  }

  const gregorianStr = d.toISOString().split('T')[0];
  const weekdayName = PERSIAN_WEEKDAYS[d.getDay()] || '-';

  try {
    const formatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-latn', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'Asia/Tehran',
    });

    const parts = formatter.formatToParts(d);
    const getPart = (type) => parts.find((p) => p.type === type)?.value || '';

    const y = parseInt(getPart('year'), 10) || 0;
    const m = parseInt(getPart('month'), 10) || 0;
    const day = parseInt(getPart('day'), 10) || 0;
    const h = getPart('hour') || '00';
    const min = getPart('minute') || '00';
    const sec = getPart('second') || '00';

    const mmStr = String(m).padStart(2, '0');
    const ddStr = String(day).padStart(2, '0');
    const dateStr = `${y}/${mmStr}/${ddStr}`;
    const timeStr = `${h}:${min}:${sec}`;
    const fullStr = `${dateStr} ${timeStr}`;
    const ymKey = `${y}/${mmStr}`;
    const monthName = m >= 1 && m <= 12 ? PERSIAN_MONTHS[m - 1] : `ماه ${m}`;

    return {
      dateStr,
      timeStr,
      fullStr,
      ymKey,
      year: y,
      month: m,
      day: day,
      monthName,
      weekdayName,
      gregorianStr,
      timestamp: d.getTime(),
    };
  } catch (err) {
    return {
      dateStr: gregorianStr,
      timeStr: d.toTimeString().split(' ')[0],
      fullStr: d.toISOString(),
      ymKey: gregorianStr.substring(0, 7),
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      monthName: `ماه ${d.getMonth() + 1}`,
      weekdayName,
      gregorianStr,
      timestamp: d.getTime(),
    };
  }
}

/**
 * Human-readable Persian labels for statuses
 */
function getPaymentStatusLabel(status) {
  switch (status) {
    case 'paid':
      return 'پرداخت موفق';
    case 'pending_payment':
      return 'در انتظار پرداخت';
    case 'pending_verification':
      return 'در انتظار تایید فیش';
    case 'failed':
      return 'ناموفق / نامعتبر';
    default:
      return status || '-';
  }
}

function getOrderStatusLabel(status) {
  switch (status) {
    case 'paid':
      return 'پرداخت شده / تکمیل';
    case 'shipped':
      return 'ارسال شده';
    case 'delivered':
      return 'تحویل داده شده';
    case 'pending':
      return 'در انتظار بررسی';
    case 'canceled':
      return 'لغو شده';
    default:
      return status || '-';
  }
}

function getPaymentMethodLabel(method) {
  switch (method) {
    case 'online':
      return 'درگاه پرداخت آنلاین';
    case 'card_to_card':
      return 'کارت به کارت';
    default:
      return method || 'نامشخص';
  }
}

/**
 * Check if order is considered a successful paid transaction
 */
function isOrderPaid(order) {
  const pStatus = (order.paymentStatus || '').trim().toLowerCase();
  const oStatus = (order.orderStatus || '').trim().toLowerCase();
  return pStatus === 'paid' || oStatus === 'paid';
}

/**
 * Summarize items inside an order
 */
function summarizeOrderItems(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return {
      summaryText: 'بدون آیتم',
      totalCount: 0,
      hasCourse: false,
      hasProduct: false,
      typeLabel: 'نامشخص',
      coursesCount: 0,
      productsCount: 0,
    };
  }

  let hasCourse = false;
  let hasProduct = false;
  let totalCount = 0;
  let coursesCount = 0;
  let productsCount = 0;

  const itemLines = items.map((item, idx) => {
    const isCourse =
      item.__component === 'order.course-order-item' ||
      Boolean(item.courseId || item.chapterId || (!item.quantity && !item.productId));
    const qty = Number(item.quantity) || 1;
    const price = Number(item.price) || 0;
    const formattedPrice = price.toLocaleString('fa-IR');

    totalCount += qty;

    if (isCourse) {
      hasCourse = true;
      coursesCount += qty;
      const typeDesc = item.chapterId ? 'فصل دوره' : 'دوره کامل';
      return `${idx + 1}. [${typeDesc}] ${item.title || 'دوره'} (${qty} عدد - ${formattedPrice} تومان)`;
    } else {
      hasProduct = true;
      productsCount += qty;
      return `${idx + 1}. [محصول] ${item.title || 'محصول'} (${qty} عدد - ${formattedPrice} تومان)`;
    }
  });

  let typeLabel = 'ترکیبی';
  if (hasCourse && !hasProduct) typeLabel = 'دوره آموزشی';
  else if (!hasCourse && hasProduct) typeLabel = 'محصول فیزیکی';

  return {
    summaryText: itemLines.join('\n'),
    totalCount,
    hasCourse,
    hasProduct,
    typeLabel,
    coursesCount,
    productsCount,
  };
}

/**
 * Calculate comprehensive financial and revenue metrics
 */
function calculateRevenueMetrics(orders = []) {
  const now = new Date();
  const nowDetails = getPersianDateDetails(now);

  const oneDayMs = 24 * 60 * 60 * 1000;
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - oneDayMs;
  const yesterdayEnd = todayStart - 1;
  const sevenDaysAgo = now.getTime() - 7 * oneDayMs;
  const thirtyDaysAgo = now.getTime() - 30 * oneDayMs;

  let totalRevenue = 0;
  let totalPaidOrders = 0;
  let totalPendingOrders = 0;
  let totalFailedOrders = 0;
  let totalAllOrders = orders.length;

  let todayRevenue = 0;
  let todayPaidOrders = 0;

  let yesterdayRevenue = 0;
  let yesterdayPaidOrders = 0;

  let weeklyRevenue = 0; // last 7 days
  let weeklyPaidOrders = 0;

  let monthlyRevenue = 0; // last 30 days
  let monthlyPaidOrders = 0;

  let currentPersianMonthRevenue = 0;
  let currentPersianMonthOrders = 0;

  let totalCourseRevenue = 0;
  let totalProductRevenue = 0;
  let totalCourseItemsSold = 0;
  let totalProductItemsSold = 0;

  const dailyMap = {}; // key: YYYY/MM/DD (Persian)
  const monthlyMap = {}; // key: YYYY/MM (Persian)

  orders.forEach((order) => {
    const paid = isOrderPaid(order);
    const orderDate = new Date(order.createdAt || order.updatedAt || Date.now());
    const dateDetails = getPersianDateDetails(orderDate);
    const orderTime = dateDetails.timestamp;
    const price = Number(order.totalPrice) || 0;
    const itemsSummary = summarizeOrderItems(order.items || []);

    if (paid) {
      totalRevenue += price;
      totalPaidOrders++;

      // Today
      if (dateDetails.dateStr === nowDetails.dateStr || orderTime >= todayStart) {
        todayRevenue += price;
        todayPaidOrders++;
      }

      // Yesterday
      if (orderTime >= yesterdayStart && orderTime <= yesterdayEnd) {
        yesterdayRevenue += price;
        yesterdayPaidOrders++;
      }

      // 7 Days
      if (orderTime >= sevenDaysAgo) {
        weeklyRevenue += price;
        weeklyPaidOrders++;
      }

      // 30 Days
      if (orderTime >= thirtyDaysAgo) {
        monthlyRevenue += price;
        monthlyPaidOrders++;
      }

      // Persian Month
      if (dateDetails.ymKey === nowDetails.ymKey) {
        currentPersianMonthRevenue += price;
        currentPersianMonthOrders++;
      }

      // Item types breakdown
      if (itemsSummary.hasCourse) {
        totalCourseItemsSold += itemsSummary.coursesCount;
        if (!itemsSummary.hasProduct) {
          totalCourseRevenue += price;
        }
      }
      if (itemsSummary.hasProduct) {
        totalProductItemsSold += itemsSummary.productsCount;
        if (!itemsSummary.hasCourse) {
          totalProductRevenue += price;
        }
      }

      // Daily Grouping
      if (!dailyMap[dateDetails.dateStr]) {
        dailyMap[dateDetails.dateStr] = {
          persianDate: dateDetails.dateStr,
          gregorianDate: dateDetails.gregorianStr,
          weekday: dateDetails.weekdayName,
          orderCount: 0,
          totalRevenue: 0,
          timestamp: dateDetails.timestamp,
        };
      }
      dailyMap[dateDetails.dateStr].orderCount += 1;
      dailyMap[dateDetails.dateStr].totalRevenue += price;

      // Monthly Grouping
      if (!monthlyMap[dateDetails.ymKey]) {
        monthlyMap[dateDetails.ymKey] = {
          persianYearMonth: dateDetails.ymKey,
          monthName: `${dateDetails.monthName} ${dateDetails.year}`,
          orderCount: 0,
          totalRevenue: 0,
          year: dateDetails.year,
          month: dateDetails.month,
        };
      }
      monthlyMap[dateDetails.ymKey].orderCount += 1;
      monthlyMap[dateDetails.ymKey].totalRevenue += price;
    } else {
      const pStatus = (order.paymentStatus || '').trim().toLowerCase();
      if (pStatus === 'failed') {
        totalFailedOrders++;
      } else {
        totalPendingOrders++;
      }
    }
  });

  const dailyBreakdown = Object.values(dailyMap).sort((a, b) => b.timestamp - a.timestamp);
  const monthlyBreakdown = Object.values(monthlyMap).sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.month - a.month;
  });

  const averageOrderValue = totalPaidOrders > 0 ? Math.round(totalRevenue / totalPaidOrders) : 0;

  return {
    generatedAtPersian: nowDetails.fullStr,
    generatedAtISO: now.toISOString(),
    metrics: {
      totalRevenue,
      todayRevenue,
      yesterdayRevenue,
      weeklyRevenue,
      monthlyRevenue,
      currentPersianMonthRevenue,
      averageOrderValue,
      totalAllOrders,
      totalPaidOrders,
      totalPendingOrders,
      totalFailedOrders,
      todayPaidOrders,
      yesterdayPaidOrders,
      weeklyPaidOrders,
      monthlyPaidOrders,
      currentPersianMonthOrders,
      totalCourseRevenue,
      totalProductRevenue,
      totalCourseItemsSold,
      totalProductItemsSold,
    },
    dailyBreakdown,
    monthlyBreakdown,
  };
}

/**
 * Generate Excel Workbook with complete details and styles
 */
async function buildOrdersWorkbook(orders = []) {
  const stats = calculateRevenueMetrics(orders);
  const { metrics, dailyBreakdown, monthlyBreakdown, generatedAtPersian } = stats;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'طرح الهی - سامانه مدیریت فروش';
  workbook.created = new Date();
  workbook.modified = new Date();

  // Common Palette & Styles
  const primaryDark = '1E293B'; // Slate 800
  const headerBlue = '0F172A'; // Slate 900
  const accentEmerald = '059669'; // Emerald 600
  const borderThin = { style: 'thin', color: { argb: 'CBD5E1' } };
  const borderMedium = { style: 'medium', color: { argb: '94A3B8' } };

  // ==========================================
  // SHEET 1: تمام خریدها و سفارش‌ها
  // ==========================================
  const wsOrders = workbook.addWorksheet('لیست کلیه سفارش‌ها', {
    views: [{ rightToLeft: true, showGridLines: true }],
  });

  // Define Columns
  wsOrders.columns = [
    { header: 'ردیف', key: 'rowNum', width: 8 },
    { header: 'کد سفارش (ID)', key: 'id', width: 14 },
    { header: 'شماره پیگیری', key: 'trackingNumber', width: 18 },
    { header: 'نام و نام خانوادگی خریدار', key: 'fullName', width: 24 },
    { header: 'شماره تماس', key: 'phone', width: 16 },
    { header: 'ایمیل', key: 'email', width: 24 },
    { header: 'نوع سفارش', key: 'typeLabel', width: 16 },
    { header: 'شرح اقلام سفارش', key: 'itemsSummary', width: 42 },
    { header: 'تعداد کل اقلام', key: 'itemsCount', width: 14 },
    { header: 'مبلغ کل (تومان)', key: 'totalPrice', width: 20 },
    { header: 'وضعیت پرداخت', key: 'paymentStatus', width: 20 },
    { header: 'وضعیت سفارش', key: 'orderStatus', width: 20 },
    { header: 'روش پرداخت', key: 'paymentMethod', width: 20 },
    { header: 'نام صاحب کارت', key: 'cardHolderName', width: 20 },
    { header: 'آدرس تحویل', key: 'address', width: 36 },
    { header: 'کد پستی', key: 'postalCode', width: 16 },
    { header: 'تاریخ ثبت (شمسی)', key: 'createdDateFa', width: 16 },
    { header: 'ساعت ثبت', key: 'createdTimeFa', width: 12 },
    { header: 'یادداشت مشتری', key: 'notes', width: 28 },
  ];

  // Header Row Styling
  const headerRow1 = wsOrders.getRow(1);
  headerRow1.height = 32;
  headerRow1.font = { name: 'Vazirmatn', bold: true, color: { argb: 'FFFFFF' }, size: 11 };
  headerRow1.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: headerBlue },
  };
  headerRow1.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

  // Add Data Rows
  orders.forEach((order, index) => {
    const createdFa = getPersianDateDetails(order.createdAt);
    const itemsInfo = summarizeOrderItems(order.items || []);
    const isPaid = isOrderPaid(order);

    const row = wsOrders.addRow({
      rowNum: index + 1,
      id: order.id || order.documentId || '-',
      trackingNumber: order.trackingNumber || '-',
      fullName: order.fullName || '-',
      phone: order.phone || '-',
      email: order.email || '-',
      typeLabel: itemsInfo.typeLabel,
      itemsSummary: itemsInfo.summaryText,
      itemsCount: itemsInfo.totalCount,
      totalPrice: Number(order.totalPrice) || 0,
      paymentStatus: getPaymentStatusLabel(order.paymentStatus),
      orderStatus: getOrderStatusLabel(order.orderStatus),
      paymentMethod: getPaymentMethodLabel(order.paymentMethod),
      cardHolderName: order.cardHolderName || '-',
      address: order.address || '-',
      postalCode: order.postalCode || '-',
      createdDateFa: createdFa.dateStr,
      createdTimeFa: createdFa.timeStr,
      notes: order.notes || '-',
    });

    row.height = 28;
    row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    row.font = { name: 'Vazirmatn', size: 10 };

    // Align text columns properly
    row.getCell('fullName').alignment = { vertical: 'middle', horizontal: 'right' };
    row.getCell('itemsSummary').alignment = { vertical: 'middle', horizontal: 'right', wrapText: true };
    row.getCell('address').alignment = { vertical: 'middle', horizontal: 'right', wrapText: true };
    row.getCell('notes').alignment = { vertical: 'middle', horizontal: 'right' };

    // Number format for price
    const priceCell = row.getCell('totalPrice');
    priceCell.numFmt = '#,##0';
    priceCell.font = { name: 'Vazirmatn', bold: true, color: { argb: '0F172A' }, size: 10 };

    // Row zebra background
    const bgRowColor = index % 2 === 0 ? 'F8FAFC' : 'FFFFFF';
    for (let c = 1; c <= wsOrders.columns.length; c++) {
      const cell = row.getCell(c);
      cell.border = {
        top: borderThin,
        left: borderThin,
        bottom: borderThin,
        right: borderThin,
      };
      if (!cell.fill) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bgRowColor },
        };
      }
    }

    // Payment Status Cell Badge Highlight
    const payCell = row.getCell('paymentStatus');
    if (isPaid) {
      payCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'DCFCE7' } }; // light green
      payCell.font = { name: 'Vazirmatn', bold: true, color: { argb: '166534' } };
    } else if (order.paymentStatus === 'failed') {
      payCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEE2E2' } }; // light red
      payCell.font = { name: 'Vazirmatn', bold: true, color: { argb: '991B1B' } };
    } else {
      payCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF3C7' } }; // light amber
      payCell.font = { name: 'Vazirmatn', bold: true, color: { argb: '92400E' } };
    }
  });

  // Freeze top row
  wsOrders.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, rightToLeft: true }];

  // ==========================================
  // SHEET 2: گزارش درآمد و آمار مالی (داشبورد)
  // ==========================================
  const wsRevenue = workbook.addWorksheet('گزارش درآمد و آمار', {
    views: [{ rightToLeft: true, showGridLines: true }],
  });

  // Set widths
  wsRevenue.getColumn('A').width = 6;
  wsRevenue.getColumn('B').width = 28;
  wsRevenue.getColumn('C').width = 24;
  wsRevenue.getColumn('D').width = 20;
  wsRevenue.getColumn('E').width = 22;
  wsRevenue.getColumn('F').width = 22;

  let curRow = 2;

  // Title Banner
  wsRevenue.mergeCells(`B${curRow}:F${curRow}`);
  const titleCell = wsRevenue.getCell(`B${curRow}`);
  titleCell.value = '📊 گزارش مالی و تحلیل درآمد سفارشات (طرح الهی)';
  titleCell.font = { name: 'Vazirmatn', bold: true, size: 15, color: { argb: 'FFFFFF' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerBlue } };
  wsRevenue.getRow(curRow).height = 38;
  curRow++;

  // Subtitle / Date
  wsRevenue.mergeCells(`B${curRow}:F${curRow}`);
  const subCell = wsRevenue.getCell(`B${curRow}`);
  subCell.value = `تاریخ گزارش‌گیری: ${generatedAtPersian}  |  تعداد کل سفارشات در سیستم: ${metrics.totalAllOrders}`;
  subCell.font = { name: 'Vazirmatn', size: 10, color: { argb: '475569' } };
  subCell.alignment = { vertical: 'middle', horizontal: 'center' };
  subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
  wsRevenue.getRow(curRow).height = 24;
  curRow += 2;

  // Section 1: KPI Table Header
  wsRevenue.mergeCells(`B${curRow}:E${curRow}`);
  const kpiSectionHeader = wsRevenue.getCell(`B${curRow}`);
  kpiSectionHeader.value = '📌 شاخص‌های کلیدی درآمد (روزانه، هفتگی، ماهانه، کل)';
  kpiSectionHeader.font = { name: 'Vazirmatn', bold: true, size: 12, color: { argb: 'FFFFFF' } };
  kpiSectionHeader.alignment = { vertical: 'middle', horizontal: 'right' };
  kpiSectionHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: accentEmerald } };
  wsRevenue.getRow(curRow).height = 28;
  curRow++;

  // KPI Table Column Headers
  const kpiHeaderRow = wsRevenue.getRow(curRow);
  kpiHeaderRow.height = 26;
  const kpiHeaders = ['شاخص مالی و درآمدی', 'مبلغ درآمد (تومان)', 'تعداد سفارشات پرداخت‌شده', 'توضیحات دوره'];
  ['B', 'C', 'D', 'E'].forEach((col, idx) => {
    const cell = wsRevenue.getCell(`${col}${curRow}`);
    cell.value = kpiHeaders[idx];
    cell.font = { name: 'Vazirmatn', bold: true, size: 10, color: { argb: 'FFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: primaryDark } };
    cell.border = { top: borderMedium, bottom: borderMedium, left: borderThin, right: borderThin };
  });
  curRow++;

  // KPI Rows Data
  const kpiRows = [
    { title: 'درآمد امروز', amount: metrics.todayRevenue, count: metrics.todayPaidOrders, desc: 'از بامداد امروز تا لحظه گزارش' },
    { title: 'درآمد دیروز', amount: metrics.yesterdayRevenue, count: metrics.yesterdayPaidOrders, desc: '۲۴ ساعت کامل روز گذشته' },
    { title: 'درآمد هفتگی (۷ روز اخیر)', amount: metrics.weeklyRevenue, count: metrics.weeklyPaidOrders, desc: 'مجموع فروش ۷ روز گذشته' },
    { title: 'درآمد ماهانه (۳۰ روز اخیر)', amount: metrics.monthlyRevenue, count: metrics.monthlyPaidOrders, desc: 'مجموع فروش ۳۰ روز گذشته' },
    { title: 'درآمد ماه جاری خورشیدی', amount: metrics.currentPersianMonthRevenue, count: metrics.currentPersianMonthOrders, desc: 'از یکم ماه شمسی تا امروز' },
    { title: 'کل درآمد تاریخ فروشگاه', amount: metrics.totalRevenue, count: metrics.totalPaidOrders, desc: 'مجموع کل خریدهای موفق' },
    { title: 'میانگین مبلغ هر سفارش (AOV)', amount: metrics.averageOrderValue, count: metrics.totalPaidOrders, desc: 'ارزش میانگین سبد خرید' },
  ];

  kpiRows.forEach((item, idx) => {
    const r = wsRevenue.getRow(curRow);
    r.height = 24;
    const isHighlight = item.title.includes('کل درآمد') || item.title.includes('درآمد امروز');

    const cellB = wsRevenue.getCell(`B${curRow}`);
    const cellC = wsRevenue.getCell(`C${curRow}`);
    const cellD = wsRevenue.getCell(`D${curRow}`);
    const cellE = wsRevenue.getCell(`E${curRow}`);

    cellB.value = item.title;
    cellC.value = item.amount;
    cellD.value = item.count;
    cellE.value = item.desc;

    cellB.alignment = { vertical: 'middle', horizontal: 'right' };
    cellC.alignment = { vertical: 'middle', horizontal: 'center' };
    cellD.alignment = { vertical: 'middle', horizontal: 'center' };
    cellE.alignment = { vertical: 'middle', horizontal: 'right' };

    cellC.numFmt = '#,##0';

    const fontStyle = { name: 'Vazirmatn', bold: isHighlight, size: 10, color: { argb: isHighlight ? '0F172A' : '334155' } };
    cellB.font = fontStyle;
    cellC.font = { name: 'Vazirmatn', bold: true, size: 11, color: { argb: '047857' } };
    cellD.font = fontStyle;
    cellE.font = { name: 'Vazirmatn', size: 9, color: { argb: '64748B' } };

    const bg = idx % 2 === 0 ? 'F8FAFC' : 'FFFFFF';
    [cellB, cellC, cellD, cellE].forEach((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      c.border = { top: borderThin, bottom: borderThin, left: borderThin, right: borderThin };
    });

    curRow++;
  });

  curRow += 2;

  // Section 2: Daily Breakdown Table (Recent 30 Days)
  wsRevenue.mergeCells(`B${curRow}:F${curRow}`);
  const dailySectionHeader = wsRevenue.getCell(`B${curRow}`);
  dailySectionHeader.value = '📅 جدول ریز درآمد روزانه (۳۰ روز اخیر)';
  dailySectionHeader.font = { name: 'Vazirmatn', bold: true, size: 12, color: { argb: 'FFFFFF' } };
  dailySectionHeader.alignment = { vertical: 'middle', horizontal: 'right' };
  dailySectionHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '2563EB' } }; // Blue 600
  wsRevenue.getRow(curRow).height = 28;
  curRow++;

  const dailyHeaders = ['ردیف', 'تاریخ شمسی', 'روز هفته', 'تعداد سفارشات', 'درآمد روزانه (تومان)'];
  ['B', 'C', 'D', 'E', 'F'].forEach((col, idx) => {
    const cell = wsRevenue.getCell(`${col}${curRow}`);
    cell.value = dailyHeaders[idx];
    cell.font = { name: 'Vazirmatn', bold: true, size: 10, color: { argb: 'FFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: primaryDark } };
    cell.border = { top: borderMedium, bottom: borderMedium, left: borderThin, right: borderThin };
  });
  wsRevenue.getRow(curRow).height = 26;
  curRow++;

  if (dailyBreakdown.length === 0) {
    wsRevenue.mergeCells(`B${curRow}:F${curRow}`);
    const emptyCell = wsRevenue.getCell(`B${curRow}`);
    emptyCell.value = 'هنوز خریدی در این دوره ثبت نشده است.';
    emptyCell.alignment = { vertical: 'middle', horizontal: 'center' };
    emptyCell.font = { name: 'Vazirmatn', size: 10, color: { argb: '64748B' } };
    curRow++;
  } else {
    dailyBreakdown.slice(0, 30).forEach((day, idx) => {
      const cellB = wsRevenue.getCell(`B${curRow}`);
      const cellC = wsRevenue.getCell(`C${curRow}`);
      const cellD = wsRevenue.getCell(`D${curRow}`);
      const cellE = wsRevenue.getCell(`E${curRow}`);
      const cellF = wsRevenue.getCell(`F${curRow}`);

      cellB.value = idx + 1;
      cellC.value = day.persianDate;
      cellD.value = day.weekday;
      cellE.value = day.orderCount;
      cellF.value = day.totalRevenue;

      cellB.alignment = { vertical: 'middle', horizontal: 'center' };
      cellC.alignment = { vertical: 'middle', horizontal: 'center' };
      cellD.alignment = { vertical: 'middle', horizontal: 'center' };
      cellE.alignment = { vertical: 'middle', horizontal: 'center' };
      cellF.alignment = { vertical: 'middle', horizontal: 'center' };

      cellF.numFmt = '#,##0';
      cellF.font = { name: 'Vazirmatn', bold: true, size: 10, color: { argb: '0F172A' } };

      const bg = idx % 2 === 0 ? 'F8FAFC' : 'FFFFFF';
      [cellB, cellC, cellD, cellE, cellF].forEach((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        c.border = { top: borderThin, bottom: borderThin, left: borderThin, right: borderThin };
      });

      wsRevenue.getRow(curRow).height = 24;
      curRow++;
    });
  }

  curRow += 2;

  // Section 3: Monthly Breakdown Table (All Months)
  wsRevenue.mergeCells(`B${curRow}:F${curRow}`);
  const monthSectionHeader = wsRevenue.getCell(`B${curRow}`);
  monthSectionHeader.value = '🗓️ جدول مقایسه درآمد ماه‌های خورشیدی';
  monthSectionHeader.font = { name: 'Vazirmatn', bold: true, size: 12, color: { argb: 'FFFFFF' } };
  monthSectionHeader.alignment = { vertical: 'middle', horizontal: 'right' };
  monthSectionHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '7C3AED' } }; // Violet 600
  wsRevenue.getRow(curRow).height = 28;
  curRow++;

  const monthHeaders = ['ردیف', 'کد ماه (سال/ماه)', 'نام ماه خورشیدی', 'تعداد سفارشات', 'درآمد کل ماه (تومان)'];
  ['B', 'C', 'D', 'E', 'F'].forEach((col, idx) => {
    const cell = wsRevenue.getCell(`${col}${curRow}`);
    cell.value = monthHeaders[idx];
    cell.font = { name: 'Vazirmatn', bold: true, size: 10, color: { argb: 'FFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: primaryDark } };
    cell.border = { top: borderMedium, bottom: borderMedium, left: borderThin, right: borderThin };
  });
  wsRevenue.getRow(curRow).height = 26;
  curRow++;

  if (monthlyBreakdown.length === 0) {
    wsRevenue.mergeCells(`B${curRow}:F${curRow}`);
    const emptyCell = wsRevenue.getCell(`B${curRow}`);
    emptyCell.value = 'هنوز داده ماهانه‌ای ثبت نشده است.';
    emptyCell.alignment = { vertical: 'middle', horizontal: 'center' };
    emptyCell.font = { name: 'Vazirmatn', size: 10, color: { argb: '64748B' } };
    curRow++;
  } else {
    monthlyBreakdown.forEach((month, idx) => {
      const cellB = wsRevenue.getCell(`B${curRow}`);
      const cellC = wsRevenue.getCell(`C${curRow}`);
      const cellD = wsRevenue.getCell(`D${curRow}`);
      const cellE = wsRevenue.getCell(`E${curRow}`);
      const cellF = wsRevenue.getCell(`F${curRow}`);

      cellB.value = idx + 1;
      cellC.value = month.persianYearMonth;
      cellD.value = month.monthName;
      cellE.value = month.orderCount;
      cellF.value = month.totalRevenue;

      cellB.alignment = { vertical: 'middle', horizontal: 'center' };
      cellC.alignment = { vertical: 'middle', horizontal: 'center' };
      cellD.alignment = { vertical: 'middle', horizontal: 'right' };
      cellE.alignment = { vertical: 'middle', horizontal: 'center' };
      cellF.alignment = { vertical: 'middle', horizontal: 'center' };

      cellF.numFmt = '#,##0';
      cellF.font = { name: 'Vazirmatn', bold: true, size: 10, color: { argb: '0F172A' } };

      const bg = idx % 2 === 0 ? 'F8FAFC' : 'FFFFFF';
      [cellB, cellC, cellD, cellE, cellF].forEach((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        c.border = { top: borderThin, bottom: borderThin, left: borderThin, right: borderThin };
      });

      wsRevenue.getRow(curRow).height = 24;
      curRow++;
    });
  }

  return { workbook, stats };
}

/**
 * Fetch all orders from database and generate Excel file
 */
async function generateAndSaveExcelReport(customFilePath = null) {
  try {
    // 1. Query all orders with items & user
    const orders = await strapi.db.query('api::order.order').findMany({
      populate: ['user', 'items'],
      orderBy: { id: 'desc' },
    });

    // 2. Build Workbook
    const { workbook, stats } = await buildOrdersWorkbook(orders || []);

    // 3. Define output path (inside public/uploads/exports to persist on Liara disk)
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    const exportsDir = path.join(uploadsDir, 'exports');
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }

    const defaultPath = path.join(exportsDir, 'orders_revenue_report.xlsx');
    const targetPath = customFilePath || defaultPath;

    // 4. Write to disk
    await workbook.xlsx.writeFile(targetPath);
    console.log(`[Order Excel Service] 📊 Successfully generated Excel report at: ${targetPath} (${orders.length} orders)`);

    return {
      success: true,
      filePath: targetPath,
      ordersCount: orders.length,
      stats,
    };
  } catch (error) {
    console.error('[Order Excel Service Error]:', error.message || error);
    throw error;
  }
}

/**
 * Generate Excel file in-memory buffer for HTTP download
 */
async function generateExcelBuffer() {
  const orders = await strapi.db.query('api::order.order').findMany({
    populate: ['user', 'items'],
    orderBy: { id: 'desc' },
  });

  const { workbook, stats } = await buildOrdersWorkbook(orders || []);
  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer, stats, ordersCount: orders.length };
}

module.exports = {
  getPersianDateDetails,
  calculateRevenueMetrics,
  buildOrdersWorkbook,
  generateAndSaveExcelReport,
  generateExcelBuffer,
};

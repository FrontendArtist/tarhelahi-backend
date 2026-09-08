'use strict';

const { parsePhoneNumberFromString } = require('libphonenumber-js');

/**
 * تبدیل ارقام فارسی و عربی به انگلیسی و پاکسازی کاراکترهای اضافی
 */
function normalizeDigits(str) {
  if (!str) return '';
  const s = String(str).trim();
  const persianNumbers = [/۰/g, /۱/g, /۲/g, /۳/g, /۴/g, /۵/g, /۶/g, /۷/g, /۸/g, /۹/g];
  const arabicNumbers = [/٠/g, /١/g, /٢/g, /٣/g, /٤/g, /٥/g, /٦/g, /٧/g, /٨/g, /٩/g];
  
  let res = s;
  for (let i = 0; i < 10; i++) {
    res = res.replace(persianNumbers[i], String(i)).replace(arabicNumbers[i], String(i));
  }
  return res;
}

/**
 * بررسی حالت تست ادمین (شماره با T یا t شروع می‌شود)
 */
function isTestPhoneNumber(rawPhone) {
  if (!rawPhone) return false;
  const digits = normalizeDigits(rawPhone);
  return /^[Tt]/.test(digits);
}

/**
 * استخراج شماره استاندارد از حالت تست
 */
function extractTestPhone(rawPhone) {
  const digits = normalizeDigits(rawPhone);
  if (/^[Tt]/.test(digits)) {
    return digits.replace(/^[Tt]0?/, '0');
  }
  return digits;
}

/**
 * بررسی آیا شماره ایرانی است یا خیر
 */
function isIranianPhoneNumber(rawPhone) {
  if (!rawPhone) return false;
  const cleaned = normalizeDigits(rawPhone);

  // شماره‌های تستی ادمین همیشه ایرانی فرض می‌شوند
  if (/^[Tt]/.test(cleaned)) {
    return true;
  }

  const digitsOnly = cleaned.replace(/[^\d+]/g, '');

  // الگوهای استاندارد موبایل ایران (09..., +989..., 00989..., 989...)
  const iranRegex = /^(?:\+98|0098|98|0)?9\d{9}$/;
  if (iranRegex.test(digitsOnly)) {
    return true;
  }

  // بررسی با پکیج libphonenumber-js
  try {
    const parsed = parsePhoneNumberFromString(digitsOnly, 'IR');
    if (parsed && parsed.country === 'IR') {
      return true;
    }
  } catch (e) {
    // خطا در پارس
  }

  return false;
}

/**
 * تبدیل و یکسان‌سازی شماره تلفن:
 * - شماره‌های ایران: 09123456789
 * - شماره‌های بین‌المللی: +14155552671 (فرمت E.164)
 */
function standardizePhoneNumber(rawPhone) {
  if (!rawPhone) return '';
  const cleaned = normalizeDigits(rawPhone);

  if (isTestPhoneNumber(cleaned)) {
    const target = extractTestPhone(cleaned);
    const iranTarget = target.replace(/^(?:\+98|0098|98)/, '0');
    return /^[Tt]/.test(cleaned) ? `T${iranTarget.startsWith('0') ? iranTarget : '0' + iranTarget}` : iranTarget;
  }

  const digitsOnly = cleaned.replace(/[^\d+]/g, '');

  if (isIranianPhoneNumber(digitsOnly)) {
    // تبدیل به فرمت 09xxxxxxxxx
    let num = digitsOnly.replace(/^(?:\+98|0098|98)/, '');
    if (!num.startsWith('0')) {
      num = '0' + num;
    }
    return num;
  }

  // شماره بین‌المللی
  try {
    let formattedInput = digitsOnly;
    if (formattedInput.startsWith('00')) {
      formattedInput = '+' + formattedInput.slice(2);
    } else if (!formattedInput.startsWith('+')) {
      formattedInput = '+' + formattedInput;
    }
    const parsed = parsePhoneNumberFromString(formattedInput);
    if (parsed && parsed.isValid()) {
      return parsed.number; // E.164 e.g. +14155552671
    }
    return formattedInput;
  } catch (e) {
    return digitsOnly;
  }
}

/**
 * اعتبارسنجی کلی شماره تلفن
 */
function validatePhoneNumber(rawPhone) {
  if (!rawPhone) return { valid: false, message: 'شماره تلفن الزامی است.' };
  
  const cleaned = normalizeDigits(rawPhone);
  if (isTestPhoneNumber(cleaned)) {
    return { valid: true, isIranian: true, isTest: true, formatted: standardizePhoneNumber(cleaned) };
  }

  const isIran = isIranianPhoneNumber(cleaned);
  const formatted = standardizePhoneNumber(cleaned);

  if (isIran) {
    const iranRegex = /^09\d{9}$/;
    if (!iranRegex.test(formatted)) {
      return { valid: false, message: 'شماره موبایل ایران باید ۱۱ رقم و با ۰۹ شروع شود.' };
    }
    return { valid: true, isIranian: true, isTest: false, formatted };
  }

  // شماره خارجی
  try {
    const parsed = parsePhoneNumberFromString(formatted);
    if (!parsed || !parsed.isValid()) {
      return { valid: false, message: 'شماره تلفن بین‌المللی نامعتبر است. لطفاً پیش‌شماره کشور (مثلاً +1) را وارد کنید.' };
    }
    return { valid: true, isIranian: false, isTest: false, formatted: parsed.number };
  } catch (e) {
    return { valid: false, message: 'فرمت شماره تلفن صحیح نیست.' };
  }
}

module.exports = {
  normalizeDigits,
  isTestPhoneNumber,
  extractTestPhone,
  isIranianPhoneNumber,
  standardizePhoneNumber,
  validatePhoneNumber,
};

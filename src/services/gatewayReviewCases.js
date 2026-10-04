'use strict';

const { randomUUID } = require('node:crypto');

const ATTEMPT = 'api::gateway-payment-attempt.gateway-payment-attempt';
const CASE = 'api::gateway-review-case.gateway-review-case';
const HISTORY = 'api::gateway-review-case-history.gateway-review-case-history';
const EVENT = 'api::gateway-payment-event.gateway-payment-event';

// دلایل مجاز برای گشودن پرونده بازبینی درگاه
const ALLOWED_REASONS = [
  'NO_CALLBACK',
  'VERIFY_UNKNOWN',
  'REVERSE_UNKNOWN',
  'DELIVERY_UNKNOWN',
  'BANK_CONFLICT',
];

/**
 * ثبت یک رکورد در تاریخچه پرونده بازبینی
 */
async function addHistory(strapi, data) {
  await strapi.db.query(HISTORY).create({
    data: {
      ...data,
      occurredAtUtc: data.occurredAtUtc || new Date().toISOString(),
    },
  });
}

/**
 * دریافت یا ایجاد پرونده بازبینی به صورت Idempotent
 * در صورت بروز تعارض ناشی از اجرای هم‌زمان، روی رکورد ایجادشده همگرا می‌شود.
 */
async function getOrCreateCase(strapi, attempt, reasonCode, details = {}) {
  if (!ALLOWED_REASONS.includes(reasonCode)) {
    throw new Error(`Invalid review reason: ${reasonCode}`);
  }

  const cases = strapi.db.query(CASE);
  let reviewCase = await cases.findOne({ where: { clientReferenceCode: attempt.resNum } });
  let created = false;

  if (!reviewCase) {
    try {
      reviewCase = await cases.create({
        data: {
          caseId: randomUUID(),
          clientReferenceCode: attempt.resNum,
          topUpRequestId: attempt.topUpRequestId,
          reasonCode,
          status: 'open',
          notificationStatus: 'pending',
          openedAtUtc: new Date().toISOString(),
        },
      });
      created = true;
    } catch (error) {
      // قیدهای یکتا در دیتابیس اجرای هم‌زمان را مهار و به یک پرونده همگرا می‌کنند.
      reviewCase = await cases.findOne({ where: { clientReferenceCode: attempt.resNum } });
      if (!reviewCase) {
        throw error;
      }
    }
  }

  // ثبت سابقه بازگشایی پرونده در صورت عدم ثبت قبلی
  const openingHistory = await strapi.db.query(HISTORY).findOne({
    where: {
      caseId: reviewCase.caseId,
      eventType: 'opened',
    },
  });

  if (!openingHistory) {
    await addHistory(strapi, {
      caseId: reviewCase.caseId,
      eventType: 'opened',
      details: {
        reasonCode: reviewCase.reasonCode,
        ...details,
      },
    });
  }

  // ضمیمه کردن تمام رویدادهای بانکی ثبت‌شده تاکنون به پرونده بازبینی
  const events = await strapi.db.query(EVENT).findMany({
    where: { resNum: attempt.resNum },
    orderBy: { occurredAtUtc: 'asc' },
    limit: 500,
  });

  for (const event of events) {
    await appendEvidence(strapi, attempt, event, 'bank_event', reviewCase);
  }

  return { reviewCase, created };
}

/**
 * افزودن شواهد و رویدادهای درگاه به پرونده بازبینی با بررسی عدم تکرار
 */
async function appendEvidence(strapi, attempt, event, type = 'bank_event', knownCase = null) {
  const existing = knownCase || await strapi.db.query(CASE).findOne({
    where: { clientReferenceCode: attempt.resNum },
  });

  if (!existing) {
    return null;
  }

  if (event?.eventId) {
    const duplicate = await strapi.db.query(HISTORY).findOne({
      where: {
        caseId: existing.caseId,
        eventId: event.eventId,
      },
    });

    if (duplicate) {
      return existing;
    }
  }

  await addHistory(strapi, {
    caseId: existing.caseId,
    eventType: type,
    eventId: event?.eventId || null,
    evidenceStage: event?.stage || null,
    evidenceKind: event?.kind || null,
    details: event ? {
      bankTransactionId: event.bankTransactionId || null,
      bankReferenceNumber: event.bankReferenceNumber || null,
      bankResultCode: event.bankResultCode || null,
      originalAmountRial: event.originalAmountRial == null ? null : Number(event.originalAmountRial),
      affectiveAmountRial: event.affectiveAmountRial == null ? null : Number(event.affectiveAmountRial),
      bankDateRaw: event.bankDateRaw || null,
      callbackState: event.rawPayload?.State || null,
      callbackStatus: event.rawPayload?.Status == null ? null : String(event.rawPayload.Status),
      verifySuccess: event.rawPayload?.Success == null ? null : Boolean(event.rawPayload.Success),
      verifyResultCode: event.rawPayload?.ResultCode == null ? null : String(event.rawPayload.ResultCode),
      occurredAtUtc: event.occurredAtUtc || null,
    } : {},
  });

  return existing;
}

/**
 * بدنه درخواست ثبت پرونده در ByeMoney
 */
function openRequest(reviewCase) {
  return {
    clientReferenceCode: reviewCase.clientReferenceCode,
    caseId: reviewCase.caseId,
    reasonCode: reviewCase.reasonCode,
  };
}

module.exports = {
  ATTEMPT,
  CASE,
  HISTORY,
  ALLOWED_REASONS,
  addHistory,
  getOrCreateCase,
  appendEvidence,
  openRequest,
};

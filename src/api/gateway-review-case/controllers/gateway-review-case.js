'use strict';

const CASE = 'api::gateway-review-case.gateway-review-case';
const HISTORY = 'api::gateway-review-case-history.gateway-review-case-history';
const ATTEMPT = 'api::gateway-payment-attempt.gateway-payment-attempt';
const OUTCOMES = ['PAID_AND_CONFIRMED', 'UNPAID_REJECTED', 'REVERSED_REJECTED'];
const { getThresholdMinutes, setThresholdMinutes } = require('../../../services/gatewayReviewRecovery');

/**
 * فرمت‌بندی آبجکت پاسخ عمومی برای پرونده بازبینی
 */
function publicCase(row, history = []) {
  return {
    caseId: row.caseId,
    clientReferenceCode: row.clientReferenceCode,
    topUpRequestId: row.topUpRequestId,
    topUpStatus: row.resolutionTopUpStatus || row.topUpStatusAtOpen || null,
    reasonCode: row.reasonCode,
    status: row.status,
    openedAtUtc: row.openedAtUtc,
    resolvedAtUtc: row.resolvedAtUtc || null,
    outcomeCode: row.outcomeCode || null,
    resolutionFinancialReferenceId: row.resolutionFinancialReferenceId || null,
    deliveryStatus: row.notificationStatus,
    deliveryError: row.notificationError || null,
    history: history.map((item) => ({
      eventType: item.eventType,
      eventId: item.eventId || null,
      evidenceStage: item.evidenceStage || null,
      evidenceKind: item.evidenceKind || null,
      details: item.details || {},
      occurredAtUtc: item.occurredAtUtc,
    })),
  };
}

/**
 * دریافت سوابق یک پرونده بازبینی
 */
async function getHistory(strapi, caseId) {
  return strapi.db.query(HISTORY).findMany({
    where: { caseId },
    orderBy: { occurredAtUtc: 'asc' },
    limit: 500,
  });
}

const methods = (strapi) => ({
  /**
   * دریافت مقدار آستانه زمانی اسکن عدم دریافت کال‌بک
   */
  async getSettings(ctx) {
    ctx.body = { noCallbackMinutes: await getThresholdMinutes(strapi) };
  },

  /**
   * تغییر مقدار آستانه زمانی اسکن عدم دریافت کال‌بک
   */
  async updateSettings(ctx) {
    try {
      const noCallbackMinutes = await setThresholdMinutes(strapi, ctx.request.body?.noCallbackMinutes);
      ctx.body = { noCallbackMinutes };
    } catch (error) {
      strapi.log?.warn?.(`Failed to update review settings: ${error.message}`);
      ctx.status = 400;
      ctx.body = { code: 'REVIEW_INVALID_THRESHOLD' };
    }
  },

  /**
   * فهرست پرونده‌های بازبینی با صفحه‌بندی و لود دسته‌ای (Batch) سوابق جهت جلوگیری از N+1
   */
  async find(ctx) {
    const page = Math.max(1, Number(ctx.query?.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(ctx.query?.pageSize) || 25));
    const filters = {};

    if (['open', 'resolved'].includes(ctx.query?.status)) {
      filters.status = ctx.query.status;
    }
    if (ctx.query?.reasonCode) {
      filters.reasonCode = ctx.query.reasonCode;
    }

    const [rows, total] = await Promise.all([
      strapi.db.query(CASE).findMany({
        where: filters,
        orderBy: { openedAtUtc: 'desc' },
        offset: (page - 1) * pageSize,
        limit: pageSize,
      }),
      strapi.db.query(CASE).count({ where: filters }),
    ]);

    // بازیابی سوابق به صورت دسته‌ای برای تمام رکوردهای صفحه جهت حذف N+1 Query
    const caseIds = rows.map((r) => r.caseId);
    const allHistories = caseIds.length > 0
      ? await strapi.db.query(HISTORY).findMany({
          where: { caseId: { $in: caseIds } },
          orderBy: { occurredAtUtc: 'asc' },
          limit: 1000,
        })
      : [];

    const historyByCaseId = new Map();
    for (const h of allHistories) {
      if (!historyByCaseId.has(h.caseId)) {
        historyByCaseId.set(h.caseId, []);
      }
      historyByCaseId.get(h.caseId).push(h);
    }

    ctx.body = {
      data: rows.map((row) => publicCase(row, historyByCaseId.get(row.caseId) || [])),
      pagination: { page, pageSize, total },
    };
  },

  /**
   * دریافت جزئیات یک پرونده بازبینی همراه با زنجیره شواهد
   */
  async findOne(ctx) {
    const reference = String(ctx.params.clientReferenceCode || '');
    const row = await strapi.db.query(CASE).findOne({ where: { clientReferenceCode: reference } });
    if (!row) {
      return ctx.notFound();
    }
    ctx.body = { data: publicCase(row, await getHistory(strapi, row.caseId)) };
  },

  /**
   * تعیین تکلیف نهایی پرونده بازبینی توسط ادمین و ارسال به ByeMoney
   */
  async resolve(ctx) {
    const reference = String(ctx.params.clientReferenceCode || '');
    const input = ctx.request.body || {};
    const outcomeCode = String(input.outcomeCode || '');

    if (outcomeCode === 'MANUAL_REFUND') {
      ctx.status = 422;
      ctx.body = { code: 'REVIEW_MANUAL_REFUND_NOT_SUPPORTED' };
      return;
    }

    const isUnpaidRejectedWithRef = outcomeCode === 'UNPAID_REJECTED' && input.resolutionFinancialReferenceId != null;
    const isOtherOutcomeWithoutRef = outcomeCode !== 'UNPAID_REJECTED' && !String(input.resolutionFinancialReferenceId || '').trim();

    if (!OUTCOMES.includes(outcomeCode) || isUnpaidRejectedWithRef || isOtherOutcomeWithoutRef) {
      ctx.status = 400;
      ctx.body = { code: 'REVIEW_INVALID_RESOLUTION' };
      return;
    }

    const reviewCase = await strapi.db.query(CASE).findOne({ where: { clientReferenceCode: reference } });
    if (!reviewCase) {
      return ctx.notFound();
    }

    // بررسی Idempotency در صورتی که پرونده قبلاً با همین نتیجه ریزالو شده باشد
    if (reviewCase.status === 'resolved') {
      const same = reviewCase.outcomeCode === outcomeCode &&
        (reviewCase.resolutionFinancialReferenceId || null) === (input.resolutionFinancialReferenceId || null);
      if (!same) {
        ctx.status = 409;
        ctx.body = { code: 'REVIEW_CASE_CONFLICT' };
        return;
      }
      ctx.body = publicCase(reviewCase, await getHistory(strapi, reviewCase.caseId));
      return;
    }

    const base = process.env.BYEMONEY_API_URL;
    const key = process.env.STRAPI_TO_BYEMONEY_SERVICE_KEY;
    if (!base || !key || Buffer.byteLength(key, 'utf8') < 32) {
      ctx.status = 503;
      ctx.body = { code: 'REVIEW_DELIVERY_NOT_CONFIGURED' };
      return;
    }

    try {
      const response = await fetch(`${base.replace(/\/+$/, '')}/api/integrations/topups/v1/gateway-reviews/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Service-Key': key },
        body: JSON.stringify({
          clientReferenceCode: reviewCase.clientReferenceCode,
          caseId: reviewCase.caseId,
          outcomeCode,
          resolutionFinancialReferenceId: outcomeCode === 'UNPAID_REJECTED' ? null : input.resolutionFinancialReferenceId,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status >= 500) {
          await strapi.db.query(CASE).update({
            where: { caseId: reviewCase.caseId },
            data: { notificationError: 'RESOLUTION_DELIVERY_UNKNOWN' },
          });
        }
        await strapi.db.query(HISTORY).create({
          data: {
            caseId: reviewCase.caseId,
            eventType: response.status >= 500 ? 'resolution_delivery_unknown' : 'resolution_rejected',
            details: { outcomeCode, httpStatus: response.status, responseCode: result.code || null },
            occurredAtUtc: new Date().toISOString(),
          },
        });
        ctx.status = response.status;
        ctx.body = result;
        return;
      }

      const updated = await strapi.db.query(CASE).update({
        where: { caseId: reviewCase.caseId },
        data: {
          status: 'resolved',
          outcomeCode,
          resolutionFinancialReferenceId: result.resolutionFinancialReferenceId || null,
          resolutionTopUpStatus: result.topUpStatus || null,
          resolvedAtUtc: result.resolvedAtUtc || new Date().toISOString(),
        },
      });

      // همگام‌سازی وضعیت تلاش پرداخت در استراپی پس از ریزالو موفق
      const attemptStatusMap = {
        PAID_AND_CONFIRMED: 'confirmed',
        UNPAID_REJECTED: 'failed',
        REVERSED_REJECTED: 'reversed',
      };
      const targetAttemptStatus = attemptStatusMap[outcomeCode];
      if (targetAttemptStatus) {
        await strapi.db.query(ATTEMPT).update({
          where: { resNum: reviewCase.clientReferenceCode },
          data: { status: targetAttemptStatus },
        });
      }

      await strapi.db.query(HISTORY).create({
        data: {
          caseId: reviewCase.caseId,
          eventType: 'resolved',
          details: { outcomeCode, topUpStatus: result.topUpStatus || null },
          occurredAtUtc: result.resolvedAtUtc || new Date().toISOString(),
        },
      });

      ctx.body = publicCase(updated, await getHistory(strapi, reviewCase.caseId));
    } catch (error) {
      strapi.log?.error?.(`Gateway review resolution delivery failed for case ${reviewCase.caseId}: ${error.message}`);
      await strapi.db.query(CASE).update({
        where: { caseId: reviewCase.caseId },
        data: { notificationError: 'RESOLUTION_DELIVERY_UNKNOWN' },
      });
      await strapi.db.query(HISTORY).create({
        data: {
          caseId: reviewCase.caseId,
          eventType: 'resolution_delivery_unknown',
          details: { outcomeCode, error: error.message },
          occurredAtUtc: new Date().toISOString(),
        },
      });
      ctx.status = 503;
      ctx.body = { code: 'REVIEW_RESOLUTION_DELIVERY_UNKNOWN', caseId: reviewCase.caseId };
    }
  },
});

module.exports = require('@strapi/strapi').factories.createCoreController(
  'api::gateway-review-case.gateway-review-case',
  ({ strapi }) => methods(strapi)
);

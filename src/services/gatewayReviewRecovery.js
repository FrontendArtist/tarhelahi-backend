'use strict';

const { ATTEMPT, CASE, getOrCreateCase, openRequest } = require('./gatewayReviewCases');

const SETTING_STORE = { type: 'plugin', name: 'gateway-review' };
const THRESHOLD_KEY = 'noCallbackMinutes';
const DEFAULT_THRESHOLD_MINUTES = 30;
const CANDIDATE_STATUSES = ['created', 'token_issued', 'verifying', 'verified', 'review', 'financial_review', 'reverse_required', 'pending_sync'];
const OUTCOME_URL = '/api/integrations/topups/v1/gateway-reviews/open';

async function getThresholdMinutes(strapi) {
  const store = strapi.store(SETTING_STORE);
  let value = await store.get({ key: THRESHOLD_KEY });
  if (value == null) {
    await store.set({ key: THRESHOLD_KEY, value: DEFAULT_THRESHOLD_MINUTES });
    value = DEFAULT_THRESHOLD_MINUTES;
  }
  const threshold = Number(value);
  return Number.isSafeInteger(threshold) && threshold >= 1 ? threshold : DEFAULT_THRESHOLD_MINUTES;
}

async function setThresholdMinutes(strapi, value) {
  const threshold = Number(value);
  if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > 1440)
    throw new Error('noCallbackMinutes must be an integer from 1 to 1440');
  await strapi.store(SETTING_STORE).set({ key: THRESHOLD_KEY, value: threshold });
  return threshold;
}

function eligibleNoCallbackWhere(cutoff) {
  return { $or: [
    { tokenIssuedAtUtc: { $lte: cutoff } },
    { tokenIssuedAtUtc: null, createdAt: { $lte: cutoff } },
  ] };
}

async function acquireAttempt(strapi, attempt, now, cutoff) {
  const update = await strapi.db.query(ATTEMPT).updateMany({
    where: { id: attempt.id, status: 'token_issued', $and: [
      eligibleNoCallbackWhere(cutoff),
      { $or: [{ reviewScanLeaseUntilUtc: null }, { reviewScanLeaseUntilUtc: { $lt: now } }] },
    ] },
    data: { reviewScanLeaseUntilUtc: new Date(Date.parse(now) + 60_000).toISOString() },
  });
  return update.count === 1;
}

async function scanNoCallbackAttempts(strapi, now = new Date()) {
  const thresholdMinutes = await getThresholdMinutes(strapi);
  const nowIso = now.toISOString();
  const cutoff = new Date(now.getTime() - thresholdMinutes * 60_000).toISOString();
  let examined = 0;
  let opened = 0;
  let fallbackCount = 0;
  let lastId = 0;
  while (true) {
    const attempts = await strapi.db.query(ATTEMPT).findMany({
      where: { status: 'token_issued', ...eligibleNoCallbackWhere(cutoff), id: { $gt: lastId } },
      orderBy: { id: 'asc' }, limit: 200,
    });
    if (!attempts.length) break;
    for (const attempt of attempts) {
      examined += 1;
      if (attempt.tokenIssuedAtUtc == null) fallbackCount += 1;
      lastId = attempt.id;
      if (!(await acquireAttempt(strapi, attempt, nowIso, cutoff))) continue;
      try {
        const { created } = await getOrCreateCase(strapi, attempt, 'NO_CALLBACK', {
          thresholdMinutes, timestampSource: attempt.tokenIssuedAtUtc == null ? 'createdAt' : 'tokenIssuedAtUtc',
        });
        if (created) opened += 1;
      } finally {
        await strapi.db.query(ATTEMPT).update({ where: { id: attempt.id }, data: { reviewScanLeaseUntilUtc: null } });
      }
    }
    if (attempts.length < 200) break;
  }
  if (fallbackCount) strapi.log?.warn(`Gateway review scan used createdAt fallback for ${fallbackCount} attempts.`);
  return { examined, opened, fallbackCount, thresholdMinutes };
}

async function sendPendingReviewOpens(strapi, limit = 100) {
  const key = process.env.STRAPI_TO_BYEMONEY_SERVICE_KEY;
  const base = process.env.BYEMONEY_API_URL;
  const pending = await strapi.db.query(CASE).findMany({
    where: { status: 'open', notificationStatus: 'pending' }, orderBy: { createdAt: 'asc' }, limit,
  });
  if (!pending.length || !base || !key || Buffer.byteLength(key, 'utf8') < 32)
    return { sent: 0, pending: pending.length };

  let sent = 0;
  for (const reviewCase of pending) {
    try {
      const response = await fetch(`${base.replace(/\/+$/, '')}${OUTCOME_URL}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Service-Key': key },
        body: JSON.stringify(openRequest(reviewCase)), signal: AbortSignal.timeout(15_000),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        await strapi.db.query(CASE).update({ where: { caseId: reviewCase.caseId }, data: {
          notificationStatus: 'delivered', notificationError: null,
          topUpStatusAtOpen: body.topUpStatus || null,
        } });
        await strapi.db.query('api::gateway-review-case-history.gateway-review-case-history').create({ data: {
          caseId: reviewCase.caseId, eventType: 'open_delivered', details: {
            topUpStatus: body.topUpStatus || null,
          }, occurredAtUtc: new Date().toISOString(),
        } });
        sent += 1;
      } else if (response.status === 409 && body.code === 'REVIEW_CASE_CONFLICT') {
        await strapi.db.query(CASE).update({
          where: { caseId: reviewCase.caseId },
          data: {
            notificationStatus: 'conflict',
            notificationError: body.code,
          },
        });
      } else if (response.status >= 400 && response.status < 500) {
        // خطاهای ماندگار ۴xx نباید تا ابد در صف ارسال مجدد قرار گیرند
        await strapi.db.query(CASE).update({
          where: { caseId: reviewCase.caseId },
          data: {
            notificationStatus: 'conflict',
            notificationError: body.code || `HTTP_${response.status}`,
          },
        });
      } else {
        await strapi.db.query(CASE).update({
          where: { caseId: reviewCase.caseId },
          data: {
            notificationError: body.code || `HTTP_${response.status}`,
          },
        });
      }
    } catch (error) {
      strapi.log?.error?.(`Gateway review open notification failed for case ${reviewCase.caseId}: ${error.message}`);
      // رویداد پایدار در صف می‌ماند تا اجرای بعدی آن را تکرارپذیر ارسال کند.
      await strapi.db.query(CASE).update({
        where: { caseId: reviewCase.caseId },
        data: {
          notificationError: 'NETWORK_ERROR',
        },
      });
    }
  }
  return { sent, pending: pending.length - sent };
}

async function reportLegacyAttempts(strapi) {
  const report = {};
  const thresholdMinutes = await getThresholdMinutes(strapi);
  const tokenCutoff = new Date(Date.now() - thresholdMinutes * 60_000).toISOString();
  for (const status of CANDIDATE_STATUSES) {
    report[status] = status === 'token_issued'
      ? await strapi.db.query(ATTEMPT).count({ where: { status, ...eligibleNoCallbackWhere(tokenCutoff) } })
      : await strapi.db.query(ATTEMPT).count({ where: { status } });
  }
  report.token_issued_created_at_fallback = await strapi.db.query(ATTEMPT).count({ where: {
    status: 'token_issued', tokenIssuedAtUtc: null, createdAt: { $lte: tokenCutoff },
  } });
  return report;
}

async function backfillLegacyCases(strapi, { apply = false } = {}) {
  const report = await reportLegacyAttempts(strapi);
  if (!apply) return { mode: 'report_only', counts: report };
  for (const status of CANDIDATE_STATUSES) {
    const where = status === 'token_issued'
      ? { status, ...eligibleNoCallbackWhere(new Date(Date.now() - (await getThresholdMinutes(strapi)) * 60_000).toISOString()) }
      : { status };
    let offset = 0;
    while (true) {
      const attempts = await strapi.db.query(ATTEMPT).findMany({ where, orderBy: { id: 'asc' }, limit: 500, offset });
      for (const attempt of attempts) {
        const reasonCode = status === 'token_issued' ? 'NO_CALLBACK' :
          status === 'reverse_required' ? 'REVERSE_UNKNOWN' :
            ['created', 'verified', 'pending_sync'].includes(status) ? 'DELIVERY_UNKNOWN' : 'VERIFY_UNKNOWN';
        await getOrCreateCase(strapi, attempt, reasonCode, { legacyStatus: status });
      }
      if (attempts.length < 500) break;
      offset += attempts.length;
    }
  }
  return { mode: 'apply', counts: report };
}

async function recoverGatewayReviews(strapi) {
  const scan = await scanNoCallbackAttempts(strapi);
  const delivery = await sendPendingReviewOpens(strapi);
  return { scan, delivery };
}

module.exports = {
  DEFAULT_THRESHOLD_MINUTES, CANDIDATE_STATUSES, getThresholdMinutes, setThresholdMinutes,
  scanNoCallbackAttempts, sendPendingReviewOpens, reportLegacyAttempts, backfillLegacyCases,
  recoverGatewayReviews,
};

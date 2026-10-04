'use strict';

const { randomUUID } = require('node:crypto');

const ATTEMPT = 'api::gateway-payment-attempt.gateway-payment-attempt';
const EVENT = 'api::gateway-payment-event.gateway-payment-event';
const VERIFY_URL = process.env.SEP_VERIFY_URL || 'https://sep.shaparak.ir/verifyTxnRandomSessionkey/ipg/VerifyTransaction';
const REVERSE_URL = 'https://sep.shaparak.ir/verifyTxnRandomSessionkey/ipg/ReverseTransaction';

function byeMoneyBody(event) {
  return {
    clientReferenceCode: event.resNum, gateway: 'SEP', eventId: event.eventId,
    kind: event.kind, bankTransactionId: event.bankTransactionId || null,
    bankReferenceNumber: event.bankReferenceNumber || null,
    bankResultCode: event.bankResultCode || null,
    originalAmountRial: event.originalAmountRial == null ? null : Number(event.originalAmountRial),
    affectiveAmountRial: event.affectiveAmountRial == null ? null : Number(event.affectiveAmountRial),
    occurredAtUtc: new Date(event.occurredAtUtc).toISOString(),
  };
}

async function recordEvent(strapi, attempt, data) {
  return strapi.db.query(EVENT).create({ data: {
    eventId: randomUUID(), resNum: attempt.resNum, topUpRequestId: attempt.topUpRequestId,
    stage: data.stage, kind: data.kind, bankTransactionId: data.bankTransactionId || null,
    bankReferenceNumber: data.bankReferenceNumber || null,
    bankResultCode: data.bankResultCode == null ? null : String(data.bankResultCode),
    originalAmountRial: data.originalAmountRial == null ? null : Number(data.originalAmountRial),
    affectiveAmountRial: data.affectiveAmountRial == null ? null : Number(data.affectiveAmountRial),
    bankDateRaw: data.bankDateRaw || null, rawPayload: data.rawPayload || {},
    occurredAtUtc: new Date().toISOString(),
    deliveryStatus: data.stage === 'reverse_intent' ? 'delivered' : 'pending',
  } });
}

async function sendPendingEvents(strapi) {
  const events = await strapi.db.query(EVENT).findMany({
    where: { deliveryStatus: 'pending' }, orderBy: { createdAt: 'asc' }, limit: 100,
  });
  const key = process.env.STRAPI_TO_BYEMONEY_SERVICE_KEY;
  const base = process.env.BYEMONEY_API_URL;
  if (!key || Buffer.byteLength(key, 'utf8') < 32 || !base)
    throw new Error('Strapi to ByeMoney gateway delivery is not configured');
  for (const event of events) {
    try {
      const response = await fetch(`${base.replace(/\/+$/, '')}/api/integrations/topups/gateway-results`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Service-Key': key },
        body: JSON.stringify(byeMoneyBody(event)), signal: AbortSignal.timeout(15_000),
      });
      const body = await response.json().catch(() => ({}));
      const mismatch = event.kind === 'Verified' && response.status === 422 && body.code === 'TOPUP_AMOUNT_MISMATCH';
      const rejectedTopUp = event.kind === 'Verified' && response.status === 409 &&
        body.code === 'TOPUP_REQUIRES_REVIEW';
      if (!response.ok && !mismatch && !rejectedTopUp) {
        await strapi.db.query(EVENT).update({ where: { eventId: event.eventId },
          data: { deliveryStatus: response.status === 409 ? 'review' : 'pending',
            deliveryError: body.code || `HTTP_${response.status}` } });
        if (response.status === 409)
          await strapi.db.query(ATTEMPT).update({ where: { resNum: event.resNum },
            data: { status: 'financial_review', lastError: body.code || 'BYEMONEY_CONFLICT' } });
        continue;
      }
      await strapi.db.query(EVENT).update({ where: { eventId: event.eventId },
        data: { deliveryStatus: 'delivered', deliveryError: null } });
      let status = null;
      if (mismatch || rejectedTopUp) status = 'reverse_required';
      else if (event.kind === 'Verified') status = 'confirmed';
      else if (event.kind === 'ReverseSucceeded') status = 'reversed';
      else if (event.kind === 'ReverseFailed') status = 'financial_review';
      else if (event.kind === 'Unpaid') status = event.rawPayload?.State === 'CanceledByUser' ? 'cancelled' : 'failed';
      if (status) {
        const current = await strapi.db.query(ATTEMPT).findOne({ where: { resNum: event.resNum } });
        if (!['confirmed', 'reversed'].includes(current?.status) || current.status === status)
          await strapi.db.query(ATTEMPT).update({ where: { resNum: event.resNum }, data: { status } });
      }
    } catch (error) {
      await strapi.db.query(EVENT).update({ where: { eventId: event.eventId },
        data: { deliveryError: 'NETWORK_ERROR' } });
      strapi.log.error(`Gateway outcome delivery failed for ${event.resNum}: ${error.message}`);
    }
  }
}

async function callSep(url, refNum) {
  try {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ RefNum: refNum, TerminalNumber: Number(process.env.SEP_TERMINAL_ID) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { Success: false, ResultCode: null, ResultDescription: `HTTP_${response.status}` };
    return await response.json();
  } catch (_) {
    return { Success: false, ResultCode: null, ResultDescription: 'NETWORK_ERROR' };
  }
}

async function recoverVerify(strapi, attempt) {
  if (!attempt.refNum || !process.env.SEP_TERMINAL_ID) return;
  const prior = await strapi.db.query(EVENT).findOne({ where: {
    resNum: attempt.resNum, stage: 'verify', kind: 'Verified', bankTransactionId: attempt.refNum,
  } });
  if (prior) {
    await strapi.db.query(ATTEMPT).update({ where: { resNum: attempt.resNum }, data: {
      status: 'verified', rrn: prior.bankReferenceNumber,
      originalAmountRial: prior.originalAmountRial, affectiveAmountRial: prior.affectiveAmountRial,
      bankTransactionDateRaw: prior.bankDateRaw || null,
      verifiedAtUtc: prior.occurredAtUtc,
      reverseRetryUntilUtc: new Date(Date.parse(attempt.tokenIssuedAtUtc || prior.occurredAtUtc) + 50 * 60_000).toISOString(),
    } });
    return prior;
  }
  const priorEvents = await strapi.db.query(EVENT).findMany({ where: {
    resNum: attempt.resNum, stage: 'verify', bankTransactionId: attempt.refNum,
  }, orderBy: { createdAt: 'desc' }, limit: 20 });
  const invalidVerified = priorEvents.find(event => event.kind === 'Unknown' &&
    event.rawPayload?.Success === true && Number(event.rawPayload?.ResultCode) === 0);
  if (invalidVerified) {
    await strapi.db.query(ATTEMPT).update({ where: { resNum: attempt.resNum }, data: {
      status: 'reverse_required', verifiedAtUtc: invalidVerified.occurredAtUtc,
      reverseRetryUntilUtc: new Date(Date.parse(attempt.tokenIssuedAtUtc || invalidVerified.occurredAtUtc) + 50 * 60_000).toISOString(),
      lastError: 'INVALID_VERIFY_DETAIL',
    } });
    return invalidVerified;
  }
  const bank = await callSep(VERIFY_URL, attempt.refNum);
  const detail = bank.TransactionDetail || {};
  const success = bank.Success === true && Number(bank.ResultCode) === 0;
  const callback = await strapi.db.query(EVENT).findOne({ where: {
    resNum: attempt.resNum, stage: 'callback', bankTransactionId: attempt.refNum,
  } });
  const validCallback = callback?.rawPayload?.State === 'OK' &&
    String(callback?.rawPayload?.Status) === '2';
  const validDetail = success && detail.RefNum === attempt.refNum && detail.RRN &&
    String(detail.TerminalNumber) === String(process.env.SEP_TERMINAL_ID) &&
    Number.isSafeInteger(Number(detail.OrginalAmount)) && Number(detail.OrginalAmount) > 0 &&
    Number.isSafeInteger(Number(detail.AffectiveAmount)) && Number(detail.AffectiveAmount) > 0;
  const event = await recordEvent(strapi, attempt, {
    stage: 'verify', kind: validDetail && validCallback ? 'Verified' : 'Unknown',
    bankTransactionId: attempt.refNum, bankReferenceNumber: detail.RRN,
    bankResultCode: bank.ResultCode, originalAmountRial: detail.OrginalAmount,
    affectiveAmountRial: detail.AffectiveAmount, bankDateRaw: detail.StraceDate,
    rawPayload: bank,
  });
  if (success) {
    await strapi.db.query(ATTEMPT).update({ where: { resNum: attempt.resNum }, data: {
      status: validDetail && validCallback ? 'verified' : 'reverse_required', rrn: detail.RRN || null,
      originalAmountRial: detail.OrginalAmount ?? null,
      affectiveAmountRial: detail.AffectiveAmount ?? null,
      bankTransactionDateRaw: detail.StraceDate || null,
      verifiedAtUtc: event.occurredAtUtc,
      reverseRetryUntilUtc: new Date(Date.parse(attempt.tokenIssuedAtUtc || event.occurredAtUtc) + 50 * 60_000).toISOString(),
    } });
  } else if (Number(bank.ResultCode) === 2 || Number.isFinite(Number(bank.ResultCode)) &&
      Number(bank.ResultCode) < 0 && bank.ResultCode != null) {
    await strapi.db.query(ATTEMPT).update({ where: { resNum: attempt.resNum },
      data: { status: 'financial_review', lastError: `VERIFY_${bank.ResultCode ?? 'INVALID_DETAIL'}` } });
  }
  return event;
}

async function recoverReverse(strapi, attempt) {
  if (!attempt.refNum || !process.env.SEP_TERMINAL_ID) return;
  const completed = await strapi.db.query(EVENT).findOne({ where: {
    resNum: attempt.resNum, stage: 'reverse', kind: 'ReverseSucceeded',
    bankTransactionId: attempt.refNum,
  } });
  if (completed) {
    const status = completed.deliveryStatus === 'delivered' ? 'reversed' :
      completed.deliveryError && completed.deliveryError !== 'NETWORK_ERROR'
        ? 'financial_review' : 'pending_sync';
    await strapi.db.query(ATTEMPT).update({ where: { resNum: attempt.resNum },
      data: { status } });
    return completed;
  }
  const until = attempt.reverseRetryUntilUtc && Date.parse(attempt.reverseRetryUntilUtc);
  if (!until) {
    await strapi.db.query(ATTEMPT).update({ where: { resNum: attempt.resNum },
      data: { status: 'financial_review', lastError: 'MANUAL_REVIEW_NO_REVERSE_DEADLINE' } });
    return;
  }
  if (until && Date.now() >= until) {
    await strapi.db.query(ATTEMPT).update({ where: { resNum: attempt.resNum },
      data: { status: 'financial_review', lastError: 'MANUAL_REVIEW_REVERSE_WINDOW' } });
    return;
  }
  const verifyEvents = await strapi.db.query(EVENT).findMany({ where: {
    resNum: attempt.resNum, stage: 'verify', bankTransactionId: attempt.refNum,
  }, orderBy: { createdAt: 'desc' }, limit: 20 });
  const verified = verifyEvents.find(event => event.rawPayload?.Success === true &&
    Number(event.rawPayload?.ResultCode) === 0);
  if (!verified) return;
  const key = process.env.STRAPI_TO_BYEMONEY_SERVICE_KEY;
  const base = process.env.BYEMONEY_API_URL;
  let topUp;
  try {
    const response = await fetch(`${base.replace(/\/+$/, '')}/api/integrations/topups/by-reference/${encodeURIComponent(attempt.resNum)}/confirmation`, {
      headers: { 'X-Service-Key': key }, signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`BYEMONEY_${response.status}`);
    topUp = await response.json();
  } catch (_) {
    await strapi.db.query(ATTEMPT).update({ where: { resNum: attempt.resNum },
      data: { status: 'financial_review', lastError: 'BYEMONEY_STATUS_UNKNOWN' } });
    return;
  }
  if (String(topUp.status).toLowerCase() === 'confirmed') {
    await strapi.db.query(ATTEMPT).update({ where: { resNum: attempt.resNum },
      data: { status: 'financial_review', lastError: 'TOPUP_ALREADY_CONFIRMED' } });
    return;
  }
  const existingIntent = await strapi.db.query(EVENT).findOne({ where: {
    resNum: attempt.resNum, stage: 'reverse_intent', bankTransactionId: attempt.refNum,
  } });
  if (!existingIntent) await recordEvent(strapi, attempt, {
    stage: 'reverse_intent', kind: 'Unknown', bankTransactionId: attempt.refNum,
    rawPayload: { reason: attempt.lastError || 'INVALID_VERIFIED_PAYMENT' },
  });
  await strapi.db.query(ATTEMPT).update({ where: { resNum: attempt.resNum },
    data: { status: 'financial_review', reverseIntentAtUtc: new Date().toISOString() } });
  const bank = await callSep(REVERSE_URL, attempt.refNum);
  const success = bank.Success === true && Number(bank.ResultCode) === 0;
  const event = await recordEvent(strapi, attempt, {
    stage: 'reverse', kind: success ? 'ReverseSucceeded' : 'ReverseFailed',
    bankTransactionId: attempt.refNum, bankReferenceNumber: bank.TransactionDetail?.RRN,
    bankResultCode: bank.ResultCode, originalAmountRial: bank.TransactionDetail?.OrginalAmount,
    affectiveAmountRial: bank.TransactionDetail?.AffectiveAmount,
    bankDateRaw: bank.TransactionDetail?.StraceDate, rawPayload: bank,
  });
  await strapi.db.query(ATTEMPT).update({ where: { resNum: attempt.resNum },
    data: { status: success ? 'pending_sync' : 'financial_review',
      lastError: success ? null : `REVERSE_${bank.ResultCode ?? 'UNKNOWN'}` } });
  return event;
}

async function recoverGatewayTopUps(strapi) {
  await sendPendingEvents(strapi);
  const attempts = await strapi.db.query(ATTEMPT).findMany({ where: {
    status: { $in: ['verifying', 'reverse_required', 'financial_review'] },
  }, orderBy: { updatedAt: 'asc' }, limit: 100 });
  for (const attempt of attempts) {
    const claim = await strapi.db.query(ATTEMPT).updateMany({ where: {
      resNum: attempt.resNum, status: attempt.status,
      $or: [{ recoveryLeaseUntilUtc: null }, { recoveryLeaseUntilUtc: { $lt: new Date().toISOString() } }],
    }, data: { recoveryLeaseUntilUtc: new Date(Date.now() + 60_000).toISOString() } });
    if (claim.count !== 1) continue;
    try {
      if (attempt.status === 'verifying' &&
        Date.now() - Date.parse(attempt.updatedAt) >= 2 * 60_000) {
        if (attempt.refNum) await recoverVerify(strapi, attempt);
        else await strapi.db.query(ATTEMPT).update({ where: { resNum: attempt.resNum },
          data: { status: 'financial_review', lastError: 'CALLBACK_WITHOUT_REFNUM_REVIEW' } });
      }
      else if (Date.now() - Date.parse(attempt.updatedAt) >= 60_000 &&
        (attempt.status === 'reverse_required' ||
          attempt.status === 'financial_review' && attempt.reverseIntentAtUtc &&
          attempt.lastError?.startsWith('REVERSE_')))
        await recoverReverse(strapi, attempt);
    } catch (error) {
      strapi.log.error(`Gateway recovery failed for ${attempt.resNum}: ${error.message}`);
    } finally {
      await strapi.db.query(ATTEMPT).update({ where: { resNum: attempt.resNum },
        data: { recoveryLeaseUntilUtc: null } });
    }
  }
  await sendPendingEvents(strapi);
}

module.exports = { recoverGatewayTopUps };

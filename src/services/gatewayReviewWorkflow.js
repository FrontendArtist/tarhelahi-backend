'use strict';
const { isDeepStrictEqual } = require('node:util');

const CASE = 'api::gateway-review-case.gateway-review-case';
const HISTORY = 'api::gateway-review-case-history.gateway-review-case-history';
const OPERATION = 'api::gateway-review-operation.gateway-review-operation';
const ATTEMPT = 'api::gateway-payment-attempt.gateway-payment-attempt';
const OUTCOMES = ['PAID_AND_CONFIRMED', 'NO_MATCHING_DEPOSIT', 'REVERSED_REJECTED', 'MANUAL_REFUND'];

function failure(status, code) { return Object.assign(new Error(code), { status, code }); }

async function money(path, { jwt, body } = {}) {
  const base = process.env.BYEMONEY_API_URL;
  const key = process.env.STRAPI_TO_BYEMONEY_SERVICE_KEY;
  if (!base || !jwt && (!key || Buffer.byteLength(key, 'utf8') < 32))
    throw failure(503, 'REVIEW_DELIVERY_NOT_CONFIGURED');
  let response;
  try {
    response = await fetch(`${base.replace(/\/+$/, '')}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : { 'X-Service-Key': key }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
    });
  } catch (_) { throw failure(503, 'REVIEW_RESOLUTION_DELIVERY_UNKNOWN'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw failure(response.status, data.code || 'REVIEW_REQUEST_REJECTED');
  return data;
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function normalizeResolution(input) {
  const text = (value, max) => {
    if (value == null || value === '') return null;
    if (typeof value !== 'string' || value.length > max) throw failure(400, 'REVIEW_INVALID_RESOLUTION');
    return value.trim() || null;
  };
  const outcomeCode = text(input.outcomeCode, 50);
  const e = input.evidence || {};
  if (!OUTCOMES.includes(outcomeCode) || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(e.operationId || '') ||
      !Number.isSafeInteger(e.expectedRevision) || e.expectedRevision < 1 || !validDate(e.checkedReportDate) ||
      ![true, false].includes(e.matchingDepositFound)) throw failure(400, 'REVIEW_INVALID_RESOLUTION');
  const evidence = {
    operationId: e.operationId.toLowerCase(), expectedRevision: e.expectedRevision,
    checkedReportDate: e.checkedReportDate, matchingDepositFound: e.matchingDepositFound,
    note: text(e.note, 2000), depositReference: text(e.depositReference, 100),
    depositDate: e.depositDate || null, depositAmountRial: e.depositAmountRial ?? null,
    manualRefundReference: text(e.manualRefundReference, 100),
  };
  const reference = text(input.resolutionFinancialReferenceId, 100);
  if (evidence.matchingDepositFound && (!evidence.depositReference || !validDate(evidence.depositDate) ||
      !Number.isSafeInteger(evidence.depositAmountRial) || evidence.depositAmountRial <= 0 || evidence.depositDate > evidence.checkedReportDate))
    throw failure(400, 'REVIEW_INVALID_RESOLUTION');
  if (!evidence.matchingDepositFound && (evidence.depositReference || evidence.depositDate || evidence.depositAmountRial != null))
    throw failure(400, 'REVIEW_INVALID_RESOLUTION');
  if (outcomeCode === 'NO_MATCHING_DEPOSIT' && (evidence.matchingDepositFound || reference) ||
      outcomeCode === 'PAID_AND_CONFIRMED' && (!evidence.matchingDepositFound || !reference) ||
      outcomeCode === 'REVERSED_REJECTED' && !reference ||
      outcomeCode === 'MANUAL_REFUND' && (!evidence.manualRefundReference || reference))
    throw failure(400, 'REVIEW_INVALID_RESOLUTION');
  return { outcomeCode, resolutionFinancialReferenceId: reference, evidence };
}

async function projectReview(strapi, row, state) {
  if (state.caseId !== row.caseId) throw failure(409, 'REVIEW_CASE_CONFLICT');
  await strapi.db.query(CASE).updateMany({ where: { caseId: row.caseId,
    $or: [{ revision: { $lt: state.revision } }, { revision: null },
      { revision: state.revision, ...(state.resolvedAtUtc ? {} : { resolvedAtUtc: null }) }],
  }, data: {
    status: state.resolvedAtUtc ? 'resolved' : 'open', revision: state.revision,
    outcomeCode: state.outcomeCode || null, resolvedAtUtc: state.resolvedAtUtc || null,
    resolutionFinancialReferenceId: state.resolutionFinancialReferenceId || null,
    resolutionTopUpStatus: state.topUpStatus, notificationStatus: 'delivered', notificationError: null,
    resolutionAudit: state.audit || [], manualRefundReference: state.manualRefundReference || null,
  } });
  return strapi.db.query(CASE).findOne({ where: { caseId: row.caseId } });
}

async function syncReview(strapi, row) {
  // ابتدا نشانگر ایجاد می‌شود؛ شواهد پایدار تا تأیید بای‌مانی از صف حذف نمی‌شوند.
  if (row.notificationStatus !== 'delivered') await money('/api/integrations/topups/v1/gateway-reviews/open', {
    body: { clientReferenceCode: row.clientReferenceCode, caseId: row.caseId, reasonCode: row.reasonCode },
  });
  const pending = await strapi.db.query(HISTORY).findMany({
    where: { caseId: row.caseId, syncStatus: 'pending' }, orderBy: { id: 'asc' }, limit: 500,
  });
  for (const item of pending) {
    await money('/api/integrations/topups/v1/gateway-reviews/reopen', { body: {
      clientReferenceCode: row.clientReferenceCode, caseId: row.caseId,
      evidenceId: `evidence:${item.eventId}`, note: item.details?.note || null,
    } });
    await strapi.db.query(HISTORY).update({ where: { id: item.id }, data: { syncStatus: 'delivered' } });
  }
  const state = await money(`/api/integrations/topups/v1/gateway-reviews/${encodeURIComponent(row.clientReferenceCode)}`);
  let updated = await projectReview(strapi, row, state);
  // درخواست پذیرفته‌شده حتی پس از قطع پاسخ شبکه از سابقه بازیابی می‌شود.
  if (row.resolutionOperationId) {
    const audit = state.audit?.find(x => x.eventId === row.resolutionOperationId && x.eventType === 'resolved');
    if (audit) {
      await strapi.db.query(OPERATION).update({ where: { operationId: row.resolutionOperationId },
        data: { status: 'applied', result: audit } });
      await strapi.db.query(CASE).updateMany({ where: { caseId: row.caseId, resolutionOperationId: row.resolutionOperationId },
        data: { resolutionOperationId: null } });
      updated = { ...updated, resolutionOperationId: null };
    }
  }
  if (await strapi.db.query(HISTORY).count({ where: { caseId: row.caseId, syncStatus: 'pending' } })) {
    await strapi.db.query(CASE).update({ where: { caseId: row.caseId },
      data: { status: 'open', notificationStatus: 'pending', notificationError: 'REVIEW_NEW_EVIDENCE' } });
    return { ...updated, status: 'reopening', syncPending: true };
  }
  return updated;
}

async function resolveReview(strapi, row, input, jwt, actorDocumentId) {
  const payload = normalizeResolution(input);
  const operationId = payload.evidence.operationId;
  const operations = strapi.db.query(OPERATION);
  let operation = await operations.findOne({ where: { operationId } });
  if (operation && (operation.caseId !== row.caseId || operation.actorDocumentId !== actorDocumentId ||
      !isDeepStrictEqual(operation.payload, payload))) throw failure(409, 'REVIEW_CASE_CONFLICT');
  if (operation?.status === 'applied') return syncReview(strapi, row);
  if (operation?.status === 'rejected') throw failure(operation.errorStatus || 409, operation.errorCode || 'REVIEW_CASE_CONFLICT');
  row = await syncReview(strapi, row);
  if (operation) {
    operation = await operations.findOne({ where: { operationId } });
    if (operation?.status === 'applied') return row;
  }
  if (row.syncPending || row.status !== 'open' || row.revision !== payload.evidence.expectedRevision) {
    if (operation) {
      await operations.update({ where: { operationId }, data: { status: 'rejected', errorCode: 'REVIEW_CASE_CONFLICT', errorStatus: 409 } });
      await strapi.db.query(CASE).updateMany({ where: { caseId: row.caseId, resolutionOperationId: operationId }, data: { resolutionOperationId: null } });
    }
    throw failure(409, 'REVIEW_CASE_CONFLICT');
  }
  if (!operation) {
    try { operation = await operations.create({ data: { operationId, caseId: row.caseId,
      actorDocumentId, payload, status: 'pending' } }); }
    catch (_) {
      operation = await operations.findOne({ where: { operationId } });
      if (!operation || operation.caseId !== row.caseId || operation.actorDocumentId !== actorDocumentId ||
          !isDeepStrictEqual(operation.payload, payload)) throw failure(409, 'REVIEW_CASE_CONFLICT');
    }
  }
  const claim = await strapi.db.query(CASE).updateMany({ where: { caseId: row.caseId,
    $or: [{ resolutionOperationId: null }, { resolutionOperationId: operationId }] }, data: { resolutionOperationId: operationId } });
  if (claim.count !== 1) throw failure(409, 'REVIEW_RESOLUTION_IN_PROGRESS');
  // همان قفل بازیابی از هم‌زمانی تصمیم دستی با Reverse جلوگیری می‌کند.
  const leaseUntil = new Date(Date.now() + 5 * 60_000).toISOString();
  const lease = await strapi.db.query(ATTEMPT).updateMany({ where: { resNum: row.clientReferenceCode,
    $or: [{ recoveryLeaseUntilUtc: null }, { recoveryLeaseUntilUtc: { $lt: new Date().toISOString() } }] },
    data: { recoveryLeaseUntilUtc: leaseUntil } });
  if (lease.count !== 1) throw failure(409, 'REVIEW_RESOLUTION_IN_PROGRESS');
  let accepted = false;
  try {
    await money('/api/integrations/topups/v1/gateway-reviews/resolve', {
      jwt, body: { clientReferenceCode: row.clientReferenceCode, caseId: row.caseId, ...payload },
    });
    accepted = true;
    return await syncReview(strapi, { ...row, resolutionOperationId: operationId });
  } catch (error) {
    if (!accepted && error.status >= 400 && error.status < 500) {
      await operations.update({ where: { operationId }, data: { status: 'rejected', errorCode: error.code, errorStatus: error.status } });
      await strapi.db.query(CASE).updateMany({ where: { caseId: row.caseId, resolutionOperationId: operationId }, data: { resolutionOperationId: null } });
    }
    throw error;
  } finally {
    await strapi.db.query(ATTEMPT).updateMany({ where: { resNum: row.clientReferenceCode, recoveryLeaseUntilUtc: leaseUntil },
      data: { recoveryLeaseUntilUtc: null } });
  }
}

async function recoverReviewWorkflows(strapi) {
  const evidence = await strapi.db.query(HISTORY).findMany({ where: { syncStatus: 'pending' }, limit: 500 });
  const caseIds = [...new Set(evidence.map(x => x.caseId))];
  const rows = await strapi.db.query(CASE).findMany({ where: {
    $or: [{ resolutionOperationId: { $notNull: true } }, { notificationStatus: 'pending' }, { caseId: { $in: caseIds } }],
  }, orderBy: { updatedAt: 'asc' }, limit: 100 });
  for (const row of rows) {
    try { await syncReview(strapi, row); }
    catch (error) { strapi.log?.warn?.(`Gateway review synchronization: ${row.caseId} ${error.code || 'FAILED'}`); }
  }
}

module.exports = { CASE, HISTORY, OPERATION, money, failure, normalizeResolution, syncReview, resolveReview, recoverReviewWorkflows };

'use strict';

const { CASE, HISTORY, OPERATION, money, failure, syncReview, resolveReview } = require('../../../services/gatewayReviewWorkflow');
const { getThresholdMinutes, setThresholdMinutes } = require('../../../services/gatewayReviewRecovery');

function publicCase(row) {
  return {
    caseId: row.caseId, clientReferenceCode: row.clientReferenceCode, topUpRequestId: row.topUpRequestId,
    reasonCode: row.reasonCode, status: row.status, revision: row.revision || 1,
    openedAtUtc: row.openedAtUtc, resolvedAtUtc: row.resolvedAtUtc || null,
    outcomeCode: row.outcomeCode || null, resolutionFinancialReferenceId: row.resolutionFinancialReferenceId || null,
    topUpStatus: row.resolutionTopUpStatus || row.topUpStatusAtOpen || null,
    deliveryStatus: row.notificationStatus, deliveryError: row.notificationError || null,
    audit: row.resolutionAudit || [], manualRefundReference: row.manualRefundReference || null,
    syncPending: Boolean(row.syncPending),
  };
}

async function detail(strapi, row, ctx) {
  row = await syncReview(strapi, row);
  const financial = await money('/api/admin/topups/gateway-reviews/' + encodeURIComponent(row.clientReferenceCode),
    { jwt: ctx.request.headers.authorization.slice(7) });
  const page = Math.max(1, Math.floor(Number(ctx.query?.historyPage) || 1));
  const pageSize = 50;
  const [history, total] = await Promise.all([
    strapi.db.query(HISTORY).findMany({ where: { caseId: row.caseId }, orderBy: [{ occurredAtUtc: 'desc' }, { id: 'desc' }],
      offset: (page - 1) * pageSize, limit: pageSize }),
    strapi.db.query(HISTORY).count({ where: { caseId: row.caseId } }),
  ]);
  const operation = row.resolutionOperationId && await strapi.db.query(OPERATION).findOne({ where: { operationId: row.resolutionOperationId } });
  return {
    ...publicCase(row), topUpStatus: financial.topUpStatus, requestedAtUtc: financial.requestedAtUtc,
    amountRial: financial.amountRial, userName: financial.userName, userPhone: financial.userPhone,
    refNum: financial.refNum, rrn: financial.rrn, gatewayResultKind: financial.gatewayResultKind,
    canClosePaid: financial.topUpStatus === 'Confirmed' && financial.gatewayResultKind === 'Verified',
    canCloseReversed: financial.topUpStatus === 'Rejected' && financial.gatewayResultKind === 'ReverseSucceeded',
    pendingOperation: operation?.status === 'pending' ? {
      operationId: operation.operationId, canRetry: operation.actorDocumentId === ctx.state.user.documentId,
      payload: operation.actorDocumentId === ctx.state.user.documentId ? operation.payload : null,
    } : null,
    history: history.map(x => ({ eventType: x.eventType, eventId: x.eventId, evidenceStage: x.evidenceStage,
      evidenceKind: x.evidenceKind, details: x.details || {}, occurredAtUtc: x.occurredAtUtc })),
    historyPagination: { page, pageSize, total },
  };
}

const action = (handler) => async function (ctx) {
  try { await handler(ctx); }
  catch (error) { ctx.status = error.status || 503; ctx.body = { code: error.code || 'REVIEW_RESOLUTION_DELIVERY_UNKNOWN' }; }
};

module.exports = require('@strapi/strapi').factories.createCoreController(CASE, ({ strapi }) => {
  const findCase = async (ctx) => {
    const row = await strapi.db.query(CASE).findOne({ where: { clientReferenceCode: String(ctx.params.clientReferenceCode || '') } });
    if (!row) throw failure(404, 'REVIEW_NOT_FOUND');
    return row;
  };
  return {
    getSettings: action(async (ctx) => { ctx.body = { noCallbackMinutes: await getThresholdMinutes(strapi) }; }),
    updateSettings: action(async (ctx) => {
      try { ctx.body = { noCallbackMinutes: await setThresholdMinutes(strapi, ctx.request.body?.noCallbackMinutes) }; }
      catch (_) { throw failure(400, 'REVIEW_INVALID_THRESHOLD'); }
    }),
    find: action(async (ctx) => {
      const page = Math.max(1, Math.floor(Number(ctx.query?.page) || 1));
      const pageSize = Math.min(100, Math.max(1, Math.floor(Number(ctx.query?.pageSize) || 25)));
      const where = {};
      if (['open', 'resolved'].includes(ctx.query?.status)) where.status = ctx.query.status;
      if (ctx.query?.reasonCode) where.reasonCode = ctx.query.reasonCode;
      const [rows, total] = await Promise.all([
        strapi.db.query(CASE).findMany({ where, orderBy: { openedAtUtc: 'desc' }, offset: (page - 1) * pageSize, limit: pageSize }),
        strapi.db.query(CASE).count({ where }),
      ]);
      ctx.body = { data: rows.map(publicCase), pagination: { page, pageSize, total } };
    }),
    findOne: action(async (ctx) => { ctx.body = { data: await detail(strapi, await findCase(ctx), ctx) }; }),
    resolve: action(async (ctx) => {
      const row = await resolveReview(strapi, await findCase(ctx), ctx.request.body || {},
        ctx.request.headers.authorization.slice(7), ctx.state.user.documentId);
      ctx.body = await detail(strapi, row, ctx);
    }),
    reopen: action(async (ctx) => {
      const row = await findCase(ctx);
      const note = ctx.request.body?.note;
      if (typeof note !== 'string' || !note.trim() || note.length > 2000) throw failure(400, 'REVIEW_INVALID_RESOLUTION');
      const evidenceId = ctx.request.body?.evidenceId;
      if (typeof evidenceId !== 'string' || !/^[0-9a-f-]{36}$/i.test(evidenceId)) throw failure(400, 'REVIEW_INVALID_RESOLUTION');
      const { appendEvidence } = require('../../../services/gatewayReviewCases');
      await appendEvidence(strapi, { resNum: row.clientReferenceCode }, {
        eventId: evidenceId, stage: 'manual', kind: 'Unknown', occurredAtUtc: new Date().toISOString(),
        rawPayload: { note: note.trim(), actorDocumentId: ctx.state.user.documentId },
      }, 'manual_evidence', row);
      ctx.body = await detail(strapi, row, ctx);
    }),
  };
});


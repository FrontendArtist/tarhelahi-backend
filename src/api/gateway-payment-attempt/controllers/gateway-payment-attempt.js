'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const EVENT_UID = 'api::gateway-payment-event.gateway-payment-event';
const ATTEMPT_UID = 'api::gateway-payment-attempt.gateway-payment-attempt';
const { getOrCreateCase, appendEvidence, addHistory } = require('../../../services/gatewayReviewCases');

function ignoreClientTokenTimes(ctx) {
  const data = ctx.request?.body?.data || ctx.request?.body;
  if (!data || typeof data !== 'object') return;
  delete data.tokenIssuedAtUtc;
  delete data.tokenExpiresAtUtc;
}

function resultBody(event) {
  return {
    clientReferenceCode: event.resNum,
    gateway: 'SEP',
    eventId: event.eventId,
    kind: event.kind,
    bankTransactionId: event.bankTransactionId || null,
    bankReferenceNumber: event.bankReferenceNumber || null,
    bankResultCode: event.bankResultCode || null,
    originalAmountRial: event.originalAmountRial == null ? null : Number(event.originalAmountRial),
    affectiveAmountRial: event.affectiveAmountRial == null ? null : Number(event.affectiveAmountRial),
    occurredAtUtc: new Date(event.occurredAtUtc).toISOString(),
  };
}

module.exports = createCoreController('api::gateway-payment-attempt.gateway-payment-attempt', ({ strapi }) => ({
  async create(ctx) {
    ignoreClientTokenTimes(ctx);
    return super.create(ctx);
  },
  async update(ctx) {
    ignoreClientTokenTimes(ctx);
    return super.update(ctx);
  },
  async claim(ctx) {
    const resNum = String(ctx.request.body?.resNum || '');
    if (!resNum) return ctx.badRequest();
    const result = await strapi.db.query('api::gateway-payment-attempt.gateway-payment-attempt').updateMany({
      where: { resNum, status: 'token_issued' },
      data: { status: 'verifying' },
    });
    ctx.body = { claimed: result.count === 1 };
  },
  async recordOutcome(ctx) {
    const input = ctx.request.body || {};
    const resNum = String(input.resNum || '').trim();
    const eventId = String(input.eventId || '').trim();
    const stage = String(input.stage || '');
    const kind = String(input.kind || '');
    if (!resNum || !eventId || eventId.length > 100 ||
      !['callback', 'verify', 'reverse', 'reverse_intent'].includes(stage) ||
      !['Unpaid', 'Verified', 'ReverseSucceeded', 'ReverseFailed', 'Unknown'].includes(kind) ||
      JSON.stringify(input.rawPayload || {}).length > 20000) return ctx.badRequest();

    const attempt = await strapi.db.query(ATTEMPT_UID).findOne({ where: { resNum } });
    if (!attempt) return ctx.notFound();
    const events = strapi.db.query(EVENT_UID);
    let event = await events.findOne({ where: { eventId } });
    const conflicts = existing => existing.resNum !== resNum || existing.stage !== stage ||
      existing.kind !== kind || existing.bankTransactionId !== (input.bankTransactionId || null) ||
      existing.bankReferenceNumber !== (input.bankReferenceNumber || null) ||
      existing.bankResultCode !== (input.bankResultCode == null ? null : String(input.bankResultCode)) ||
      (existing.originalAmountRial == null ? null : Number(existing.originalAmountRial)) !==
        (input.originalAmountRial == null ? null : Number(input.originalAmountRial)) ||
      (existing.affectiveAmountRial == null ? null : Number(existing.affectiveAmountRial)) !==
        (input.affectiveAmountRial == null ? null : Number(input.affectiveAmountRial));
    if (event && conflicts(event)) {
      const { reviewCase } = await getOrCreateCase(strapi, attempt, 'BANK_CONFLICT', { eventId, stage });
      await addHistory(strapi, { caseId: reviewCase.caseId, eventType: 'event_conflict', eventId,
        evidenceStage: stage, evidenceKind: kind, details: { reasonCode: 'BANK_CONFLICT' } });
      ctx.status = 409;
      ctx.body = { code: 'GATEWAY_EVENT_CONFLICT' };
      return;
    }
    if (!event) {
      const data = {
        eventId, resNum, topUpRequestId: attempt.topUpRequestId, stage, kind,
        bankTransactionId: input.bankTransactionId || null,
        bankReferenceNumber: input.bankReferenceNumber || null,
        bankResultCode: input.bankResultCode == null ? null : String(input.bankResultCode),
        originalAmountRial: input.originalAmountRial == null ? null : Number(input.originalAmountRial),
        affectiveAmountRial: input.affectiveAmountRial == null ? null : Number(input.affectiveAmountRial),
        bankDateRaw: input.bankDateRaw || null,
        rawPayload: input.rawPayload || {},
        occurredAtUtc: new Date().toISOString(),
        deliveryStatus: stage === 'reverse_intent' || stage === 'callback' && kind === 'Unknown'
          ? 'delivered' : 'pending',
      };
      try {
        event = await events.create({ data });
      } catch (error) {
        event = await events.findOne({ where: { eventId } });
        if (!event) throw error;
        if (conflicts(event)) {
          ctx.status = 409;
          ctx.body = { code: 'GATEWAY_EVENT_CONFLICT' };
          return;
        }
      }
    }
    const reasonCode = stage === 'verify' && kind === 'Unknown' ? 'VERIFY_UNKNOWN' :
      stage === 'reverse' && ['Unknown', 'ReverseFailed'].includes(kind) ? 'REVERSE_UNKNOWN' : null;
    if (reasonCode) await getOrCreateCase(strapi, attempt, reasonCode, { eventId, stage, kind });
    await appendEvidence(strapi, attempt, event);
    ctx.body = { eventId, deliveryStatus: event.deliveryStatus, result: resultBody(event),
      expectedAmountRial: Number(attempt.amountRial) };
  },
  async markOutcomeDelivered(ctx) {
    const eventId = String(ctx.request.body?.eventId || '').trim();
    if (!eventId) return ctx.badRequest();
    const events = strapi.db.query(EVENT_UID);
    const event = await events.findOne({ where: { eventId } });
    if (!event) return ctx.notFound();
    if (event.deliveryStatus !== 'delivered')
      await events.update({ where: { eventId }, data: { deliveryStatus: 'delivered', deliveryError: null } });
    ctx.body = { delivered: true };
  },
}));

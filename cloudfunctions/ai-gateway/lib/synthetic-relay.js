/** Fail-closed orchestration for synthetic, pre-reserved AI generation. */

'use strict'

async function runSyntheticChat(input, deps) {
  let authorization
  try {
    authorization = await deps.authorize(input)
  }
  catch (error) {
    return fail(error?.code || 'lease_capability_invalid', error?.message || '测试租约能力无效。')
  }

  const operation = {
    action: authorization.action,
    amount: input.cost,
    billingAppId: authorization.billingAppId,
    bizId: input.bizId,
    claims: authorization.claims,
    identity: input.identity,
    scopeId: authorization.scopeId,
    uid: input.uid,
  }

  let reservation
  try {
    reservation = await deps.reserve(operation)
  }
  catch {
    return fail('synthetic_budget_unavailable', '测试预算服务暂时不可用。')
  }
  if (reservation.kind !== 'reserved')
    return reservationFailure(reservation.kind)

  const stateInput = { ...operation, reservationId: reservation.reservationId }
  let started
  try {
    started = await deps.start(stateInput)
  }
  catch {
    return fail('synthetic_budget_unavailable', '测试预算服务暂时不可用。')
  }
  if (started.kind !== 'started')
    return reservationFailure(started.kind)

  let content
  try {
    content = await deps.generate(input.messages)
    if (typeof content !== 'string' || !content.trim())
      throw new Error('empty model result')
  }
  catch {
    try {
      await deps.failGeneration(stateInput)
    }
    catch {
      await bestEffortReconcile(deps, stateInput)
      return fail('synthetic_reconcile_required', '模型状态需要对账，请勿重试同一请求。')
    }
    return fail('ai_failed', '模型生成失败，请重试（未扣云币）。')
  }

  let succeeded
  try {
    succeeded = await deps.succeedGeneration(stateInput)
  }
  catch {
    await bestEffortReconcile(deps, stateInput)
    return fail('synthetic_reconcile_required', '模型状态需要对账，请勿重试同一请求。')
  }
  if (succeeded.kind !== 'succeeded')
    return reservationFailure(succeeded.kind)

  let billing
  try {
    billing = await deps.deduct({
      amount: input.cost,
      appId: authorization.billingAppId,
      bizId: input.bizId,
      reservationId: reservation.reservationId,
      syntheticLeaseId: authorization.claims.leaseId,
      syntheticScopeId: authorization.scopeId,
      userId: input.uid,
    })
  }
  catch {
    await bestEffortReconcile(deps, stateInput)
    return fail('synthetic_reconcile_required', '扣费状态需要对账，请勿重试同一请求。')
  }

  try {
    await deps.settle({
      ...stateInput,
      coinTransactionId: billing?.transactionId,
    })
  }
  catch {
    await bestEffortReconcile(deps, stateInput)
    return fail('synthetic_reconcile_required', '扣费状态需要对账，请勿重试同一请求。')
  }

  return {
    ok: true,
    content,
    balance: billing.balance,
    deduped: !!billing.deduped,
  }
}

async function bestEffortReconcile(deps, input) {
  try {
    await deps.markReconcile(input)
  }
  catch {}
}

function reservationFailure(kind) {
  switch (kind) {
    case 'budget_exceeded':
      return fail('synthetic_budget_exceeded', '本次测试租约预算已用尽。')
    case 'in_progress':
      return fail('synthetic_in_progress', '同一测试请求正在处理中，请勿重复提交。')
    case 'already_processed':
      return fail('synthetic_already_processed', '同一测试请求已处理，不能重复生成。')
    case 'lease_inactive':
      return fail('lease_inactive', '测试租约已结束，结果未交付。')
    case 'reconcile_required':
      return fail('synthetic_reconcile_required', '测试请求正在等待对账。')
    default:
      return fail('synthetic_forbidden', '测试身份不允许执行该操作。')
  }
}

function fail(code, message) {
  return { ok: false, code, message }
}

module.exports = { runSyntheticChat }

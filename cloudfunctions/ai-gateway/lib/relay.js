/**
 * 通用「计费 + 受控 AI 生成」编排（依赖注入纯函数，便于单测）。
 *
 * 与具体业务/春联无关：只认 messages（通用聊天）+ cost（按次计价）。
 * 流程：登录校验 → 余额预检（够不够 cost，省下白生成的模型开销）→ 生成（管理员身份）
 *       → 成功后扣费（bizId 幂等）。
 *
 * 业务原则：
 *   - 生成失败不扣费（用户不为失败付费）；
 *   - 扣费异常不浪费已生成结果，余额回退本地估算（下次刷新校准）；
 *   - 余额预检读取失败属基础设施异常，直接抛出（由上层兜底为 5xx），不吞成业务码。
 */

'use strict'

/**
 * @param {{ uid: string, cost: number, messages: Array, bizId: string }} input
 * @param {{
 *   getBalance: (uid: string) => Promise<number>,
 *   generate: (messages: Array) => Promise<string>,
 *   deduct: (params: { amount: number, bizId: string }) => Promise<{ balance: number, deduped?: boolean }>,
 * }} deps
 * @returns {Promise<
 *   | { ok: true, content: string, balance: number, deduped: boolean }
 *   | { ok: false, code: string, message: string }
 * >}
 */
async function runMeteredChat({ uid, cost, messages, bizId }, deps) {
  if (!uid)
    return fail('unauthorized', '请先登录后再使用。')

  // 余额预检：不够直接拒，避免白白消耗一次模型调用。读余额失败＝基础设施异常→抛出。
  const balance = await deps.getBalance(uid)
  if (balance < cost)
    return fail('insufficient', '云币余额不足，请充值后再生成。')

  // 生成（管理员身份调 AI）；失败不扣费
  let content = ''
  try {
    content = await deps.generate(messages)
  }
  catch {
    content = ''
  }
  if (!content || !content.trim())
    return fail('ai_failed', '模型生成失败，请重试（未扣云币）。')

  // 成功后扣费（bizId 幂等）；扣费异常不浪费已生成结果，余额回退估算
  let nextBalance = balance - cost
  let deduped = false
  try {
    const r = await deps.deduct({ amount: cost, bizId })
    nextBalance = typeof r?.balance === 'number' ? r.balance : nextBalance
    deduped = !!(r && r.deduped)
  }
  catch {
    // 已生成、扣费失败：返回估算余额
  }

  return { ok: true, content, balance: nextBalance, deduped }
}

function fail(code, message) {
  return { ok: false, code, message }
}

module.exports = { runMeteredChat }

/** Pure orchestration and privacy-safe formatting for reward-claim operations. */

'use strict'

const ALERT_LABELS = {
  published: '活动已发布',
  usage_80: '领取达到 80%',
  exhausted: '库存已耗尽',
  expired: '活动已到期',
  repeated_failures: '连续入账异常',
  data_inconsistent: '数据一致性异常',
}

const ALERT_HEADER_TEMPLATES = {
  published: 'green',
  usage_80: 'orange',
  exhausted: 'orange',
  expired: 'blue',
  repeated_failures: 'red',
  data_inconsistent: 'red',
}

const RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000, 6 * 3_600_000]

function retryDelayMs(attempts) {
  const index = Math.min(Math.max(Number(attempts) || 1, 1) - 1, RETRY_DELAYS_MS.length - 1)
  return RETRY_DELAYS_MS[index]
}

function safeText(value, fallback = '-') {
  if (typeof value !== 'string')
    return fallback
  const text = value.replace(/[\r\n\t]+/g, ' ').trim()
  return text ? text.slice(0, 120) : fallback
}

function rewardClaimAlertLines(alert) {
  const payload = alert?.payload && typeof alert.payload === 'object' ? alert.payload : {}
  const lines = [
    `**活动：**${safeText(payload.title)}`,
    `**内部标识：**${safeText(payload.code)}`,
  ]
  if (Number.isSafeInteger(payload.totalInventory))
    lines.push(`**总库存：**${payload.totalInventory}`)
  if (Number.isSafeInteger(payload.succeededCount))
    lines.push(`**已到账：**${payload.succeededCount}`)
  if (Number.isSafeInteger(payload.reservedCount))
    lines.push(`**处理中预占：**${payload.reservedCount}`)
  if (Number.isSafeInteger(payload.affectedClaims))
    lines.push(`**${Number(payload.windowMinutes) || 10} 分钟内异常领取：**${payload.affectedClaims}`)
  if (typeof payload.code === 'string' && alert?.kind === 'data_inconsistent')
    lines.push(`**异常码：**${safeText(payload.code)}`)
  return lines
}

function rewardClaimDetailUrl(alert, adminUrl) {
  if (typeof adminUrl !== 'string' || !/^https:\/\//.test(adminUrl))
    return null
  try {
    const url = new URL(adminUrl)
    url.search = ''
    url.hash = ''
    if (typeof alert?.campaignId === 'string' && alert.campaignId.trim())
      url.pathname = `${url.pathname.replace(/\/+$/, '')}/${encodeURIComponent(alert.campaignId.trim())}`
    return url.toString()
  }
  catch {
    return null
  }
}

function formatRewardClaimAlert(alert, adminUrl) {
  const lines = [
    `【权益领取】${ALERT_LABELS[alert?.kind] || '运营事件'}`,
    ...rewardClaimAlertLines(alert).map(line => line.replaceAll('**', '')),
  ]
  const detailUrl = rewardClaimDetailUrl(alert, adminUrl)
  if (detailUrl)
    lines.push(`后台：${detailUrl}`)
  return lines.join('\n')
}

function buildRewardClaimAlertCard(alert, adminUrl) {
  const label = ALERT_LABELS[alert?.kind] || '运营事件'
  const elements = [{
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: rewardClaimAlertLines(alert).join('\n'),
    },
  }]
  const detailUrl = rewardClaimDetailUrl(alert, adminUrl)
  if (detailUrl) {
    elements.push({
      tag: 'action',
      actions: [{
        tag: 'button',
        text: { tag: 'plain_text', content: '查看活动详情' },
        type: 'primary',
        url: detailUrl,
      }],
    })
  }
  return {
    config: { wide_screen_mode: true },
    header: {
      template: ALERT_HEADER_TEMPLATES[alert?.kind] || 'blue',
      title: { tag: 'plain_text', content: `权益领取 · ${label}` },
    },
    elements,
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message.slice(0, 200) : 'unknown delivery error'
}

async function runRewardClaimOps({ sweep, store, notify, now = Date.now(), workerId }) {
  if (typeof sweep !== 'function'
    || !store
    || typeof store.leaseDue !== 'function'
    || typeof notify !== 'function'
    || typeof workerId !== 'string'
    || !workerId) {
    throw new TypeError('reward claim ops dependencies are incomplete')
  }
  let sweepResult
  let ok = true
  try {
    sweepResult = await sweep()
    if (Array.isArray(sweepResult?.errors) && sweepResult.errors.length)
      ok = false
  }
  catch (error) {
    ok = false
    sweepResult = { error: errorMessage(error) }
  }

  const alerts = await store.leaseDue(now, workerId, 20)
  let sent = 0
  let failed = 0
  for (const alert of alerts) {
    try {
      await notify(alert)
      await store.markSent(alert._id, workerId, now)
      sent++
    }
    catch (error) {
      ok = false
      failed++
      await store.markFailed(
        alert._id,
        workerId,
        now,
        now + retryDelayMs(alert.attempts),
        errorMessage(error),
      )
    }
  }
  const prunedRateLimits = typeof store.pruneRateLimits === 'function'
    ? await store.pruneRateLimits(now, 100)
    : 0
  return {
    ok,
    sweep: sweepResult,
    alerts: {
      leased: alerts.length,
      sent,
      failed,
    },
    prunedRateLimits,
  }
}

module.exports = {
  ALERT_HEADER_TEMPLATES,
  ALERT_LABELS,
  RETRY_DELAYS_MS,
  buildRewardClaimAlertCard,
  formatRewardClaimAlert,
  rewardClaimDetailUrl,
  retryDelayMs,
  runRewardClaimOps,
}

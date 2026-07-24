/** Fixed-entitlement shared-link campaigns with reserved inventory and stable settlement ids. */

'use strict'

const crypto = require('node:crypto')
const { publicLinkDigest } = require('./reward-claim-security')

const COIN_REWARD_AMOUNTS = new Set([0, 100, 1000])
const MEMBERSHIP_REWARD_DAYS = new Set([0, 30, 90, 365])
const CAMPAIGN_CODE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DEFAULT_MEMBERSHIP_HIGH_THRESHOLD_DAYS = 3650

class RewardClaimError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message)
    this.name = 'RewardClaimError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

function stableHash(namespace, ...parts) {
  return crypto.createHash('sha256')
    .update(JSON.stringify([namespace, ...parts]))
    .digest('hex')
}

function defaultIds() {
  return {
    campaign: code => `rcc_${stableHash('reward_claim_campaign', code).slice(0, 24)}`,
    claim: (campaignId, userId) => `rcl_${stableHash('reward_claim', campaignId, userId).slice(0, 24)}`,
    grant: (campaignId, userId) => `grant:claim:${campaignId}:${stableHash('reward_claim_user', userId).slice(0, 16)}`,
    audit: (campaignId, action, at) =>
      `rca_${stableHash('reward_claim_audit', campaignId, action, at, crypto.randomUUID()).slice(0, 24)}`,
    alert: (campaignId, kind, version) =>
      `rct_${stableHash('reward_claim_alert', campaignId, kind, version).slice(0, 24)}`,
  }
}

function assertOwner(actor) {
  if (!actor || actor.role !== 'owner' || typeof actor.login !== 'string' || !actor.login.trim())
    throw new RewardClaimError('forbidden', '只有 Owner 可以执行该操作', 403)
}

function assertViewer(actor) {
  if (!actor
    || !['owner', 'admin'].includes(actor.role)
    || typeof actor.login !== 'string'
    || !actor.login.trim()) {
    throw new RewardClaimError('forbidden', '无权查看权益领取活动', 403)
  }
}

function assertSystemOrOwner(actor) {
  if (actor?.role === 'system' && typeof actor.login === 'string' && actor.login)
    return
  assertOwner(actor)
}

function normalizeString(value, field, { min = 1, max = 200 } = {}) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized.length < min || normalized.length > max)
    throw new RewardClaimError('invalid_input', `${field} 长度必须为 ${min}-${max} 个字符`)
  return normalized
}

function titleWarnings(title) {
  const warnings = []
  if (title.length < 6 || title.length > 16)
    warnings.push('recommended_length')
  if (!title.includes('云乐坊'))
    warnings.push('recommended_brand_prefix')
  if (/\d+\s*[云币元天份]/.test(title))
    warnings.push('avoid_amount')
  if (/首批|第[一二三四五六七八九十\d]+批|批次/.test(title))
    warnings.push('avoid_batch')
  if (/20\d{2}|[01]?\d月|日期/.test(title))
    warnings.push('avoid_date')
  if (/专属|仅限|独享/.test(title))
    warnings.push('avoid_unverified_exclusivity')
  return warnings
}

function normalizeReward(reward) {
  const coinAmount = Number(reward?.coinAmount) || 0
  const membershipDays = Number(reward?.membershipDays) || 0
  if (!COIN_REWARD_AMOUNTS.has(coinAmount))
    throw new RewardClaimError('invalid_reward', '云币奖励仅支持 100 或 1000 云币')
  if (!MEMBERSHIP_REWARD_DAYS.has(membershipDays))
    throw new RewardClaimError('invalid_reward', '会员奖励仅支持 30、90 或 365 天')
  if (!coinAmount && !membershipDays)
    throw new RewardClaimError('invalid_reward', '至少选择一项奖励')
  return { coinAmount, membershipDays }
}

function normalizeDraftInput(raw) {
  if (!raw || typeof raw !== 'object')
    throw new RewardClaimError('invalid_input', '活动参数必须为对象')
  const title = normalizeString(raw.title, '活动标题', { max: 80 })
  const description = normalizeString(raw.description, '活动说明', { max: 200 })
  const code = normalizeString(raw.code, '内部标识', { min: 3, max: 64 })
  if (!CAMPAIGN_CODE_RE.test(code))
    throw new RewardClaimError('invalid_code', '内部标识只能包含小写字母、数字和连字符')
  if (raw.distributionMode !== 'shared')
    throw new RewardClaimError('invalid_distribution_mode', '第一版仅支持共享领取链接')
  const reward = normalizeReward(raw.reward)
  const totalInventory = Number(raw.totalInventory)
  if (!Number.isSafeInteger(totalInventory) || totalInventory < 1 || totalInventory > 100_000)
    throw new RewardClaimError('invalid_inventory', '库存必须是 1-100000 的整数')
  const startsAt = Number(raw.startsAt)
  const endsAt = Number(raw.endsAt)
  if (!Number.isSafeInteger(startsAt) || !Number.isSafeInteger(endsAt) || endsAt <= startsAt)
    throw new RewardClaimError('invalid_schedule', '开始与结束时间无效')
  return {
    title,
    description,
    code,
    distributionMode: 'shared',
    reward,
    totalInventory,
    startsAt,
    endsAt,
  }
}

function createPreview(raw, membershipThresholdDays = DEFAULT_MEMBERSHIP_HIGH_THRESHOLD_DAYS) {
  const input = normalizeDraftInput(raw)
  const coinLiability = input.reward.coinAmount * input.totalInventory
  const membershipDaysLiability = input.reward.membershipDays * input.totalInventory
  const confirmationReasons = []
  if (input.reward.coinAmount === 1000)
    confirmationReasons.push('single_coin_1000')
  if (input.reward.membershipDays === 365)
    confirmationReasons.push('single_membership_365')
  if (coinLiability >= 10_000)
    confirmationReasons.push('coin_total_10000')
  if (membershipDaysLiability >= membershipThresholdDays)
    confirmationReasons.push('membership_total_high')
  return {
    ...input,
    coinLiability,
    yuanApprox: coinLiability / 10,
    membershipDaysLiability,
    requiresStrongConfirmation: confirmationReasons.length > 0,
    confirmationReasons,
    titleWarnings: titleWarnings(input.title),
    userCopy: {
      title: input.title,
      description: input.description,
      reward: [
        input.reward.coinAmount ? `${input.reward.coinAmount} 云币` : '',
        input.reward.membershipDays ? `会员 ${input.reward.membershipDays} 天` : '',
      ].filter(Boolean).join(' + '),
      claimLimit: '每个账户限领一次',
      expiration: '领取后的权益不会因活动结束而失效',
    },
  }
}

function effectiveAvailability(campaign, now) {
  if (!campaign)
    return 'unavailable'
  if (campaign.lifecycle === 'draft')
    return 'unpublished'
  if (campaign.lifecycle === 'paused')
    return 'paused'
  if (campaign.lifecycle === 'ended')
    return campaign.endedReason === 'expired' ? 'expired' : 'ended'
  if (now < campaign.startsAt)
    return 'scheduled'
  if (now >= campaign.endsAt)
    return 'expired'
  const remaining = campaign.totalInventory - campaign.reservedCount - campaign.succeededCount
  return remaining <= 0 ? 'exhausted' : 'active'
}

function availabilityError(availability) {
  const errors = {
    unpublished: ['campaign_unpublished', '活动尚未发布'],
    scheduled: ['campaign_scheduled', '活动尚未开始'],
    paused: ['campaign_paused', '活动已暂停'],
    ended: ['campaign_ended', '活动已结束'],
    expired: ['campaign_expired', '活动已过期'],
    exhausted: ['campaign_exhausted', '活动奖励已领完'],
  }
  const [code, message] = errors[availability] || ['link_unavailable', '领取链接不可用']
  return new RewardClaimError(code, message, code === 'link_unavailable' ? 404 : 409)
}

function isInventoryValid(campaign) {
  return !!campaign
    && Number.isSafeInteger(campaign.totalInventory)
    && Number.isSafeInteger(campaign.reservedCount)
    && Number.isSafeInteger(campaign.succeededCount)
    && campaign.totalInventory >= 0
    && campaign.reservedCount >= 0
    && campaign.succeededCount >= 0
    && campaign.reservedCount + campaign.succeededCount <= campaign.totalInventory
}

function assertInventory(campaign) {
  if (!isInventoryValid(campaign))
    throw new RewardClaimError('data_inconsistent', '活动库存数据异常，已停止处理', 503)
}

function publicClaim(claim) {
  if (!claim)
    return undefined
  return {
    claimId: claim.claimId,
    status: claim.status,
    grantId: claim.grantId,
    ...(Number.isFinite(claim.balanceAfter) ? { balanceAfter: claim.balanceAfter } : {}),
    ...(Number.isFinite(claim.succeededAt) ? { claimedAt: claim.succeededAt } : {}),
    ...(claim.status === 'failed' ? { retryable: true } : {}),
  }
}

function publicCampaign(campaign, availability, claim) {
  return {
    availability,
    campaign: {
      title: campaign.title,
      description: campaign.description,
      reward: { ...campaign.reward },
      remainingCount: Math.max(
        0,
        campaign.totalInventory - campaign.reservedCount - campaign.succeededCount,
      ),
      claimLimit: 1,
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
      rewardExpires: false,
    },
    viewer: {
      authenticated: !!claim,
      ...(claim ? { claim: publicClaim(claim) } : {}),
    },
  }
}

function auditRecord(ids, campaign, action, actor, now, detail = {}) {
  return {
    _id: ids.audit(campaign._id, action, now),
    campaignId: campaign._id,
    action,
    actor: actor.login,
    actorRole: actor.role,
    detail,
    createdAt: now,
  }
}

function alertRecord(ids, campaign, kind, now, payload = {}, dedupVersion) {
  const version = dedupVersion ?? campaign.inventoryVersion
  return {
    _id: ids.alert(campaign._id, kind, version),
    campaignId: campaign._id,
    kind,
    inventoryVersion: version,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: now,
    payload: {
      title: campaign.title,
      code: campaign.code,
      ...payload,
    },
    createdAt: now,
  }
}

function createRewardClaimCampaignService(deps) {
  if (!deps?.store || !deps?.token || !deps?.reward || !deps?.eligibility)
    throw new Error('reward claim campaign dependencies are incomplete')
  const ids = deps.id || defaultIds()
  const now = deps.now || Date.now
  const membershipThresholdDays = Number(deps.membershipHighThresholdDays)
    || DEFAULT_MEMBERSHIP_HIGH_THRESHOLD_DAYS

  async function quarantineCampaign(campaignId, detail = {}) {
    const at = now()
    return deps.store.runTransaction(async (transaction) => {
      const current = await transaction.getCampaign(campaignId)
      if (!current)
        return null
      if (Number.isFinite(current.quarantinedAt))
        return current
      const next = {
        ...current,
        lifecycle: 'paused',
        quarantinedAt: at,
        revision: current.revision + 1,
        updatedBy: 'reward-claim-guard',
        updatedAt: at,
      }
      await transaction.setCampaign(next)
      await transaction.appendAudit(auditRecord(
        ids,
        next,
        'campaign_quarantined',
        { login: 'reward-claim-guard', role: 'system' },
        at,
        { code: detail.code || 'data_inconsistent' },
      ))
      await transaction.putAlert(alertRecord(
        ids,
        next,
        'data_inconsistent',
        at,
        { code: detail.code || 'data_inconsistent' },
        current.revision,
      ))
      return next
    })
  }

  async function createDraft(raw, actor) {
    assertOwner(actor)
    const preview = createPreview(raw, membershipThresholdDays)
    const at = now()
    const campaign = {
      _id: ids.campaign(preview.code),
      code: preview.code,
      title: preview.title,
      description: preview.description,
      distributionMode: preview.distributionMode,
      reward: preview.reward,
      lifecycle: 'draft',
      startsAt: preview.startsAt,
      endsAt: preview.endsAt,
      totalInventory: preview.totalInventory,
      reservedCount: 0,
      succeededCount: 0,
      inventoryVersion: 1,
      activeLinkVersion: null,
      revision: 1,
      createdBy: actor.login,
      createdAt: at,
      updatedBy: actor.login,
      updatedAt: at,
    }
    await deps.store.runTransaction(async (transaction) => {
      if (await transaction.findCampaignByCode(campaign.code))
        throw new RewardClaimError('campaign_code_conflict', '内部标识已存在', 409)
      await transaction.setCampaign(campaign)
      await transaction.appendAudit(auditRecord(ids, campaign, 'campaign_created', actor, at))
    })
    return { ...campaign, titleWarnings: preview.titleWarnings }
  }

  async function updateDraft(campaignId, patch, actor) {
    assertOwner(actor)
    return deps.store.runTransaction(async (transaction) => {
      const campaign = await transaction.getCampaign(campaignId)
      if (!campaign)
        throw new RewardClaimError('campaign_not_found', '活动不存在', 404)
      if (campaign.lifecycle !== 'draft')
        throw new RewardClaimError('campaign_immutable', '活动发布后不能修改承诺', 409)
      const nextInput = normalizeDraftInput({
        ...campaign,
        ...patch,
        reward: patch?.reward ?? campaign.reward,
      })
      const updated = {
        ...campaign,
        ...nextInput,
        revision: campaign.revision + 1,
        updatedBy: actor.login,
        updatedAt: now(),
      }
      await transaction.setCampaign(updated)
      return updated
    })
  }

  async function publish(campaignId, confirmation, actor) {
    assertOwner(actor)
    const rawToken = deps.token.generate()
    const digest = deps.token.digest(rawToken)
    const at = now()
    const campaign = await deps.store.runTransaction(async (transaction) => {
      const current = await transaction.getCampaign(campaignId)
      if (!current)
        throw new RewardClaimError('campaign_not_found', '活动不存在', 404)
      if (current.lifecycle !== 'draft')
        throw new RewardClaimError('campaign_already_published', '活动已经发布', 409)
      assertInventory(current)
      const preview = createPreview(current, membershipThresholdDays)
      if (preview.requiresStrongConfirmation && confirmation?.title !== current.title)
        throw new RewardClaimError('strong_confirmation_required', '请输入完整活动标题确认发布', 409)
      const next = {
        ...current,
        lifecycle: 'published',
        activeLinkVersion: 1,
        revision: current.revision + 1,
        publishedBy: actor.login,
        publishedAt: at,
        updatedBy: actor.login,
        updatedAt: at,
      }
      await transaction.setLink({
        _id: digest,
        campaignId: current._id,
        version: 1,
        status: 'active',
        createdBy: actor.login,
        createdAt: at,
      })
      await transaction.setCampaign(next)
      await transaction.appendAudit(auditRecord(ids, next, 'campaign_published', actor, at))
      await transaction.putAlert(alertRecord(ids, next, 'published', at, {
        totalInventory: next.totalInventory,
      }))
      return next
    })
    return {
      campaign,
      rawToken,
      url: deps.token.publicUrl(rawToken),
    }
  }

  async function rotateLink(campaignId, actor) {
    assertOwner(actor)
    const rawToken = deps.token.generate()
    const digest = deps.token.digest(rawToken)
    const at = now()
    const campaign = await deps.store.runTransaction(async (transaction) => {
      const current = await transaction.getCampaign(campaignId)
      if (!current)
        throw new RewardClaimError('campaign_not_found', '活动不存在', 404)
      if (!['published', 'paused'].includes(current.lifecycle))
        throw new RewardClaimError('campaign_not_rotatable', '活动当前状态不能轮换链接', 409)
      const activeLinks = await transaction.listActiveLinks(current._id)
      for (const link of activeLinks) {
        await transaction.setLink({
          ...link,
          status: 'revoked',
          revokedBy: actor.login,
          revokedAt: at,
        })
      }
      const version = (current.activeLinkVersion || 0) + 1
      await transaction.setLink({
        _id: digest,
        campaignId: current._id,
        version,
        status: 'active',
        createdBy: actor.login,
        createdAt: at,
      })
      const next = {
        ...current,
        activeLinkVersion: version,
        revision: current.revision + 1,
        updatedBy: actor.login,
        updatedAt: at,
      }
      await transaction.setCampaign(next)
      await transaction.appendAudit(auditRecord(ids, next, 'link_rotated', actor, at, { version }))
      return next
    })
    return { campaign, rawToken, url: deps.token.publicUrl(rawToken) }
  }

  async function changeLifecycle(campaignId, action, actor) {
    assertOwner(actor)
    const allowed = {
      pause: ['published'],
      resume: ['paused'],
      end: ['published', 'paused'],
    }
    if (!allowed[action])
      throw new RewardClaimError('invalid_lifecycle_action', '未知生命周期操作')
    const at = now()
    return deps.store.runTransaction(async (transaction) => {
      const current = await transaction.getCampaign(campaignId)
      if (!current)
        throw new RewardClaimError('campaign_not_found', '活动不存在', 404)
      if (!allowed[action].includes(current.lifecycle))
        throw new RewardClaimError('campaign_state_conflict', '活动当前状态不能执行该操作', 409)
      if (action === 'resume' && at >= current.endsAt)
        throw new RewardClaimError('campaign_expired', '活动已过期', 409)
      const lifecycle = action === 'pause' ? 'paused' : action === 'resume' ? 'published' : 'ended'
      const next = {
        ...current,
        lifecycle,
        revision: current.revision + 1,
        updatedBy: actor.login,
        updatedAt: at,
        ...(action === 'end'
          ? { endedBy: actor.login, endedAt: at, endedReason: 'manual' }
          : {}),
      }
      await transaction.setCampaign(next)
      await transaction.appendAudit(auditRecord(
        ids,
        next,
        action === 'pause' ? 'campaign_paused' : action === 'resume' ? 'campaign_resumed' : 'campaign_ended',
        actor,
        at,
      ))
      return next
    })
  }

  async function addInventory(campaignId, input, actor) {
    assertOwner(actor)
    const amount = Number(input?.amount)
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100_000)
      throw new RewardClaimError('invalid_inventory', '追加库存必须是正整数')
    const at = now()
    return deps.store.runTransaction(async (transaction) => {
      const current = await transaction.getCampaign(campaignId)
      if (!current)
        throw new RewardClaimError('campaign_not_found', '活动不存在', 404)
      if (!['published', 'paused'].includes(current.lifecycle))
        throw new RewardClaimError('campaign_state_conflict', '活动当前状态不能追加库存', 409)
      assertInventory(current)
      const totalInventory = current.totalInventory + amount
      const preview = createPreview({ ...current, totalInventory }, membershipThresholdDays)
      if (preview.requiresStrongConfirmation && input?.confirmationTitle !== current.title)
        throw new RewardClaimError('strong_confirmation_required', '请输入完整活动标题确认追加库存', 409)
      const next = {
        ...current,
        totalInventory,
        inventoryVersion: current.inventoryVersion + 1,
        revision: current.revision + 1,
        updatedBy: actor.login,
        updatedAt: at,
      }
      await transaction.setCampaign(next)
      await transaction.appendAudit(auditRecord(ids, next, 'inventory_added', actor, at, {
        amount,
        totalInventory,
        addedCoinLiability: current.reward.coinAmount * amount,
      }))
      return next
    })
  }

  async function inspect(rawToken, viewerId) {
    let digest
    try {
      digest = deps.token.digest(rawToken)
    }
    catch {
      return { availability: 'unavailable', viewer: { authenticated: !!viewerId } }
    }
    return deps.store.runTransaction(async (transaction) => {
      const link = await transaction.getLink(digest)
      if (!link || link.status !== 'active')
        return { availability: 'unavailable', viewer: { authenticated: !!viewerId } }
      const campaign = await transaction.getCampaign(link.campaignId)
      if (!campaign || campaign.activeLinkVersion !== link.version)
        return { availability: 'unavailable', viewer: { authenticated: !!viewerId } }
      if (!isInventoryValid(campaign)) {
        if (Number.isFinite(campaign.quarantinedAt))
          return { availability: 'unavailable', viewer: { authenticated: !!viewerId } }
        const at = now()
        const next = {
          ...campaign,
          lifecycle: 'paused',
          quarantinedAt: at,
          revision: campaign.revision + 1,
          updatedBy: 'reward-claim-guard',
          updatedAt: at,
        }
        await transaction.setCampaign(next)
        await transaction.appendAudit(auditRecord(
          ids,
          next,
          'campaign_quarantined',
          { login: 'reward-claim-guard', role: 'system' },
          at,
          { code: 'invalid_inventory' },
        ))
        await transaction.putAlert(alertRecord(
          ids,
          next,
          'data_inconsistent',
          at,
          { code: 'invalid_inventory' },
          campaign.revision,
        ))
        return { availability: 'unavailable', viewer: { authenticated: !!viewerId } }
      }
      const claim = viewerId
        ? await transaction.getClaim(ids.claim(campaign._id, viewerId))
        : null
      const view = publicCampaign(campaign, effectiveAvailability(campaign, now()), claim)
      view.viewer.authenticated = !!viewerId
      return view
    })
  }

  async function markUnknown(claimId, error) {
    const at = now()
    return deps.store.runTransaction(async (transaction) => {
      const claim = await transaction.getClaim(claimId)
      if (!claim)
        throw new RewardClaimError('data_inconsistent', '领取记录不存在', 503)
      if (claim.status === 'succeeded')
        return claim
      const next = {
        ...claim,
        status: 'processing',
        processingReason: 'unknown',
        lastError: {
          code: error?.code || 'settlement_unknown',
          message: error?.message || '奖励到账结果待核验',
          kind: 'unknown',
        },
        nextReconcileAt: at + 120_000,
        updatedAt: at,
      }
      await transaction.setClaim(next)
      return next
    })
  }

  async function finishSuccess(claimId, outcome) {
    const at = now()
    return deps.store.runTransaction(async (transaction) => {
      const claim = await transaction.getClaim(claimId)
      if (!claim)
        throw new RewardClaimError('data_inconsistent', '领取记录不存在', 503)
      if (claim.status === 'succeeded')
        return claim
      if (!claim.reservationHeld)
        throw new RewardClaimError('data_inconsistent', '领取记录未持有库存预占', 503)
      const campaign = await transaction.getCampaign(claim.campaignId)
      assertInventory(campaign)
      if (campaign.reservedCount < 1)
        throw new RewardClaimError('data_inconsistent', '活动预占库存异常', 503)
      const nextClaim = {
        ...claim,
        status: 'succeeded',
        processingReason: undefined,
        reservationHeld: false,
        balanceAfter: Number.isFinite(outcome.balanceAfter) ? outcome.balanceAfter : undefined,
        lastError: undefined,
        nextReconcileAt: undefined,
        succeededAt: at,
        updatedAt: at,
      }
      const nextCampaign = {
        ...campaign,
        reservedCount: campaign.reservedCount - 1,
        succeededCount: campaign.succeededCount + 1,
        revision: campaign.revision + 1,
        updatedAt: at,
      }
      assertInventory(nextCampaign)
      await transaction.setClaim(nextClaim)
      await transaction.setCampaign(nextCampaign)
      const threshold = Math.ceil(nextCampaign.totalInventory * 0.8)
      if (campaign.succeededCount < threshold && nextCampaign.succeededCount >= threshold) {
        await transaction.putAlert(alertRecord(ids, nextCampaign, 'usage_80', at, {
          succeededCount: nextCampaign.succeededCount,
          totalInventory: nextCampaign.totalInventory,
        }))
      }
      if (nextCampaign.totalInventory - nextCampaign.reservedCount - nextCampaign.succeededCount === 0) {
        await transaction.putAlert(alertRecord(ids, nextCampaign, 'exhausted', at, {
          succeededCount: nextCampaign.succeededCount,
          reservedCount: nextCampaign.reservedCount,
        }))
      }
      return nextClaim
    })
  }

  async function finishFailure(claimId, outcome) {
    const at = now()
    return deps.store.runTransaction(async (transaction) => {
      const claim = await transaction.getClaim(claimId)
      if (!claim)
        throw new RewardClaimError('data_inconsistent', '领取记录不存在', 503)
      if (!claim.reservationHeld)
        return claim
      const campaign = await transaction.getCampaign(claim.campaignId)
      assertInventory(campaign)
      if (campaign.reservedCount < 1)
        throw new RewardClaimError('data_inconsistent', '活动预占库存异常', 503)
      const nextClaim = {
        ...claim,
        status: 'failed',
        processingReason: undefined,
        reservationHeld: false,
        lastError: {
          code: outcome.code || 'settlement_failed',
          message: outcome.message || '奖励发放失败',
          kind: 'definitive',
        },
        failedAt: at,
        updatedAt: at,
      }
      await transaction.setClaim(nextClaim)
      await transaction.setCampaign({
        ...campaign,
        reservedCount: campaign.reservedCount - 1,
        revision: campaign.revision + 1,
        updatedAt: at,
      })
      return nextClaim
    })
  }

  async function settle(claim, campaign) {
    if (claim.processingReason === 'unknown') {
      const inspected = await deps.reward.inspect(claim.grantId)
      if (inspected?.kind === 'completed')
        return finishSuccess(claim.claimId, inspected)
      if (inspected?.kind === 'conflict')
        throw new RewardClaimError('data_inconsistent', '奖励记录归属冲突', 503)
    }
    let outcome
    try {
      outcome = await deps.reward.grant({
        grantId: claim.grantId,
        campaignId: campaign._id,
        userId: claim.userId,
        rewardName: campaign.title,
        coinAmount: campaign.reward.coinAmount,
        membershipDays: campaign.reward.membershipDays,
        operator: `reward-claim:${campaign.code}`,
      })
    }
    catch (error) {
      outcome = {
        kind: 'unknown',
        code: 'settlement_exception',
        message: error instanceof Error ? error.message : '奖励到账结果待核验',
      }
    }
    if (outcome?.kind === 'completed')
      return finishSuccess(claim.claimId, outcome)
    if (outcome?.kind === 'definitive_failure')
      return finishFailure(claim.claimId, outcome)
    return markUnknown(claim.claimId, outcome)
  }

  async function claim(input, userId) {
    if (typeof userId !== 'string' || !userId)
      throw new RewardClaimError('login_required', '请先登录', 401)
    const tokenDigest = deps.token.digest(input?.token)
    const rateIdentity = await deps.rateTicket?.verify(input?.rateTicket, {
      tokenDigest: publicLinkDigest(input?.token),
    }) || { ipHash: 'unavailable' }
    await deps.rateLimit?.consume({
      campaignKey: tokenDigest,
      accountHash: stableHash('reward_claim_account_rate', userId),
      ipHash: rateIdentity.ipHash,
      now: now(),
    })
    const eligibility = await deps.eligibility.inspect(userId)
    if (!eligibility?.eligible)
      throw new RewardClaimError('account_ineligible', eligibility?.message || '当前账户不能领取该奖励', 403)

    let campaignIdForGuard
    let reservation
    try {
      reservation = await deps.store.runTransaction(async (transaction) => {
        const link = await transaction.getLink(tokenDigest)
        if (!link || link.status !== 'active')
          throw availabilityError('unavailable')
        const campaign = await transaction.getCampaign(link.campaignId)
        if (!campaign || campaign.activeLinkVersion !== link.version)
          throw availabilityError('unavailable')
        campaignIdForGuard = campaign._id
        assertInventory(campaign)
        const claimId = ids.claim(campaign._id, userId)
        const existing = await transaction.getClaim(claimId)
        if (existing?.status === 'succeeded')
          return { campaign, claim: existing, settled: true }
        if (existing?.status === 'processing' && existing.reservationHeld)
          return { campaign, claim: existing, settled: false }

        const availability = effectiveAvailability(campaign, now())
        if (availability !== 'active')
          throw availabilityError(availability)
        const remaining = campaign.totalInventory - campaign.reservedCount - campaign.succeededCount
        if (remaining <= 0)
          throw availabilityError('exhausted')
        const at = now()
        const nextClaim = {
          ...(existing || {}),
          _id: claimId,
          claimId,
          campaignId: campaign._id,
          userId,
          nicknameSnapshot: eligibility.nickname || '云乐坊用户',
          grantId: existing?.grantId || ids.grant(campaign._id, userId),
          status: 'processing',
          processingReason: 'settling',
          reservationHeld: true,
          attempts: (existing?.attempts || 0) + 1,
          lastError: undefined,
          createdAt: existing?.createdAt || at,
          updatedAt: at,
        }
        const nextCampaign = {
          ...campaign,
          reservedCount: campaign.reservedCount + 1,
          revision: campaign.revision + 1,
          updatedAt: at,
        }
        assertInventory(nextCampaign)
        await transaction.setClaim(nextClaim)
        await transaction.setCampaign(nextCampaign)
        if (remaining === 1) {
          await transaction.putAlert(alertRecord(ids, nextCampaign, 'exhausted', at, {
            succeededCount: nextCampaign.succeededCount,
            reservedCount: nextCampaign.reservedCount,
          }))
        }
        return { campaign: nextCampaign, claim: nextClaim, settled: false }
      })
    }
    catch (error) {
      if (error?.code === 'data_inconsistent' && campaignIdForGuard)
        await quarantineCampaign(campaignIdForGuard, { code: 'invalid_inventory' })
      throw error
    }
    if (reservation.settled)
      return publicClaim(reservation.claim)
    try {
      return publicClaim(await settle(reservation.claim, reservation.campaign))
    }
    catch (error) {
      if (error?.code === 'data_inconsistent')
        await quarantineCampaign(reservation.campaign._id, { code: 'settlement_inconsistent' })
      throw error
    }
  }

  function adminCampaignView(campaign) {
    assertInventory(campaign)
    return {
      ...campaign,
      availability: effectiveAvailability(campaign, now()),
      remainingCount: campaign.totalInventory - campaign.reservedCount - campaign.succeededCount,
      actualCoinGranted: campaign.reward.coinAmount * campaign.succeededCount,
      actualMembershipDaysGranted: campaign.reward.membershipDays * campaign.succeededCount,
    }
  }

  async function listCampaigns(input, actor) {
    assertViewer(actor)
    const result = await deps.store.listCampaigns(input)
    const items = result.items
      .map(adminCampaignView)
      .filter(item => !input?.lifecycle || item.lifecycle === input.lifecycle)
    return { ...result, items }
  }

  async function getAdminCampaign(campaignId, actor) {
    assertViewer(actor)
    const campaign = await deps.store.getCampaign(campaignId)
    if (!campaign)
      throw new RewardClaimError('campaign_not_found', '活动不存在', 404)
    const [claims, audits, alerts] = await Promise.all([
      deps.store.listClaims({ campaignId, limit: 100 }),
      deps.store.listAudits({ campaignId, limit: 100 }),
      deps.store.listAlerts({ campaignId, limit: 100 }),
    ])
    return {
      campaign: adminCampaignView(campaign),
      stats: {
        processingCount: claims.items.filter(item => item.status === 'processing').length,
        failedCount: claims.items.filter(item => item.status === 'failed').length,
        correctedCount: claims.items.filter(item => Number.isFinite(item.correctedAt)).length,
      },
      recentClaims: claims.items,
      audits: audits.items,
      alerts: alerts.items,
    }
  }

  async function listClaims(campaignId, input, actor) {
    assertViewer(actor)
    const campaign = await deps.store.getCampaign(campaignId)
    if (!campaign)
      throw new RewardClaimError('campaign_not_found', '活动不存在', 404)
    return deps.store.listClaims({ ...input, campaignId })
  }

  async function reconcile(claimId, actor) {
    assertOwner(actor)
    const claim = await deps.store.getClaim(claimId)
    if (!claim)
      throw new RewardClaimError('claim_not_found', '领取记录不存在', 404)
    if (claim.status === 'succeeded')
      return claim
    if (claim.status !== 'processing' || !claim.reservationHeld)
      throw new RewardClaimError('claim_not_reconcilable', '领取记录当前不能对账恢复', 409)
    const campaign = await deps.store.getCampaign(claim.campaignId)
    if (!campaign)
      throw new RewardClaimError('data_inconsistent', '领取记录所属活动不存在', 503)
    const attempted = await deps.store.runTransaction(async (transaction) => {
      const current = await transaction.getClaim(claimId)
      if (!current
        || current.status !== 'processing'
        || !current.reservationHeld
        || current.grantId !== claim.grantId) {
        throw new RewardClaimError('claim_not_reconcilable', '领取记录当前不能对账恢复', 409)
      }
      const nextClaim = {
        ...current,
        attempts: (current.attempts || 0) + 1,
        updatedAt: now(),
      }
      await transaction.setClaim(nextClaim)
      return nextClaim
    })
    let next
    try {
      next = await settle({ ...attempted, processingReason: 'unknown' }, campaign)
    }
    catch (error) {
      if (error?.code === 'data_inconsistent')
        await quarantineCampaign(campaign._id, { code: 'settlement_inconsistent' })
      throw error
    }
    const at = now()
    await deps.store.runTransaction(async (transaction) => {
      await transaction.appendAudit(auditRecord(ids, campaign, 'claim_reconciled', actor, at, {
        claimId,
        status: next.status,
      }))
    })
    return next
  }

  async function correct(claimId, rawReason, actor) {
    assertOwner(actor)
    const reason = normalizeString(rawReason, '纠正原因', { max: 200 })
    const claim = await deps.store.getClaim(claimId)
    if (!claim)
      throw new RewardClaimError('claim_not_found', '领取记录不存在', 404)
    if (claim.status !== 'succeeded')
      throw new RewardClaimError('claim_not_correctable', '只有已到账领取可以纠正', 409)
    if (Number.isFinite(claim.correctedAt))
      return claim
    const campaign = await deps.store.getCampaign(claim.campaignId)
    if (!campaign)
      throw new RewardClaimError('data_inconsistent', '领取记录所属活动不存在', 503)
    const correctionId = `correction:${claim.grantId}`
    const result = await deps.reward.correct({
      correctionId,
      grantId: claim.grantId,
      reason,
      operator: actor.login,
    })
    const at = now()
    return deps.store.runTransaction(async (transaction) => {
      const current = await transaction.getClaim(claimId)
      if (!current || current.grantId !== claim.grantId)
        throw new RewardClaimError('data_inconsistent', '领取记录在纠正期间发生冲突', 503)
      const next = {
        ...current,
        correctedAt: at,
        correction: result,
        updatedAt: at,
      }
      await transaction.setClaim(next)
      await transaction.appendAudit(auditRecord(ids, campaign, 'claim_corrected', actor, at, {
        claimId,
        correctionId,
        reason,
        status: result?.status || 'unknown',
      }))
      return next
    })
  }

  async function sweep(actor) {
    assertSystemOrOwner(actor)
    const at = now()
    const campaignsPage = await deps.store.listCampaigns({ limit: 100 })
    let expired = 0
    let reconciled = 0
    const errors = []
    for (const campaign of campaignsPage.items) {
      if (!isInventoryValid(campaign)) {
        await quarantineCampaign(campaign._id, { code: 'invalid_inventory' })
        errors.push({ campaignId: campaign._id, error: '活动库存数据异常，已暂停活动' })
        continue
      }
      if (['published', 'paused'].includes(campaign.lifecycle) && at >= campaign.endsAt) {
        try {
          await deps.store.runTransaction(async (transaction) => {
            const current = await transaction.getCampaign(campaign._id)
            if (!current || !['published', 'paused'].includes(current.lifecycle) || at < current.endsAt)
              return
            const next = {
              ...current,
              lifecycle: 'ended',
              endedBy: actor.login,
              endedAt: at,
              endedReason: 'expired',
              revision: current.revision + 1,
              updatedBy: actor.login,
              updatedAt: at,
            }
            await transaction.setCampaign(next)
            await transaction.appendAudit(auditRecord(ids, next, 'campaign_expired', actor, at))
            await transaction.putAlert(alertRecord(ids, next, 'expired', at))
            expired++
          })
        }
        catch (error) {
          errors.push({ campaignId: campaign._id, error: error?.message || String(error) })
        }
      }
      const processing = await deps.store.listClaims({
        campaignId: campaign._id,
        status: 'processing',
        limit: 100,
      })
      for (const item of processing.items) {
        if (Number.isFinite(item.nextReconcileAt) && item.nextReconcileAt > at)
          continue
        if (item.attempts >= 3)
          continue
        try {
          await reconcile(item.claimId, { login: actor.login, role: 'owner' })
          reconciled++
        }
        catch (error) {
          errors.push({ claimId: item.claimId, error: error?.message || String(error) })
        }
      }
      const failed = await deps.store.listClaims({
        campaignId: campaign._id,
        status: 'failed',
        limit: 100,
      })
      const unknown = await deps.store.listClaims({
        campaignId: campaign._id,
        status: 'processing',
        limit: 100,
      })
      const recentFailureCount = [...failed.items, ...unknown.items]
        .filter(item => item.updatedAt >= at - 600_000)
        .filter(item => item.status === 'failed' || item.processingReason === 'unknown')
        .length
      if (recentFailureCount >= 3) {
        await deps.store.runTransaction(async (transaction) => {
          const current = await transaction.getCampaign(campaign._id)
          if (!current)
            return
          await transaction.putAlert(alertRecord(
            ids,
            current,
            'repeated_failures',
            at,
            { affectedClaims: recentFailureCount, windowMinutes: 10 },
            Math.floor(at / 600_000),
          ))
        })
      }
    }
    return { expired, reconciled, errors }
  }

  return {
    preview: raw => createPreview(raw, membershipThresholdDays),
    createDraft,
    updateDraft,
    publish,
    rotateLink,
    changeLifecycle,
    addInventory,
    inspect,
    claim,
    listCampaigns,
    getAdminCampaign,
    listClaims,
    reconcile,
    correct,
    sweep,
  }
}

module.exports = {
  CAMPAIGN_CODE_RE,
  RewardClaimError,
  createRewardClaimCampaignService,
  effectiveAvailability,
  normalizeDraftInput,
}

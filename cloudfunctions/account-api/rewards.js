/** Owner-issued rewards: idempotent assets, immutable source records and user notifications. */

'use strict'

const crypto = require('node:crypto')

const { MEMBERSHIPS_COLLECTION, readMembership } = require('./lib/orders')
const { clawbackCoin, creditCoin } = require('./lib/wallet')
const { createRewardNotification } = require('./notifications')
const { readProfileDoc } = require('./profiles')
const { classifyAccountIdentity } = require('./synthetic')

const REWARD_OPERATIONS_COLLECTION = 'reward_operations'
const REWARD_CORRECTIONS_COLLECTION = 'reward_corrections'
const MEMBERSHIP_ENTITLEMENT_TRANSACTIONS_COLLECTION = 'membership_entitlement_transactions'
const FIXED_COIN_REWARD = 100
const FIXED_MEMBERSHIP_DAYS = 30
const DAY_MS = 86_400_000

function stableId(namespace, value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([namespace, value]))
    .digest('hex')
    .slice(0, 24)
}

function docData(result) {
  if (Array.isArray(result?.data))
    return result.data[0] || null
  return result?.data && typeof result.data === 'object' ? result.data : null
}

function assertIdentifier(value, field) {
  if (typeof value !== 'string' || !/^[\w:-]{4,128}$/.test(value))
    throw new Error(`${field} 无效`)
  return value
}

function assertUserId(value) {
  if (typeof value !== 'string' || !/^[\w:-]{1,128}$/.test(value))
    throw new Error('userId 无效')
  return value
}

function normalizeRewardInput(input) {
  if (!input || typeof input !== 'object')
    throw new Error('奖励参数必须为对象')
  const grantId = assertIdentifier(input.grantId, 'grantId')
  const campaignId = assertIdentifier(input.campaignId, 'campaignId')
  const userId = assertUserId(input.userId)
  const rewardName = typeof input.rewardName === 'string' ? input.rewardName.trim() : ''
  if (!rewardName || rewardName.length > 80)
    throw new Error('rewardName 长度必须为 1-80 个字符')
  const coinAmount = Number(input.coinAmount) || 0
  const membershipDays = Number(input.membershipDays) || 0
  if (coinAmount !== 0 && coinAmount !== FIXED_COIN_REWARD)
    throw new Error(`云币奖励固定为 ${FIXED_COIN_REWARD}`)
  if (membershipDays !== 0 && membershipDays !== FIXED_MEMBERSHIP_DAYS)
    throw new Error(`会员奖励固定为 ${FIXED_MEMBERSHIP_DAYS} 天`)
  if (!coinAmount && !membershipDays)
    throw new Error('至少选择一项奖励')
  const operator = typeof input.operator === 'string' ? input.operator.trim() : ''
  if (!operator)
    throw new Error('operator 必填')
  const now = Number(input.now) || Date.now()
  return { grantId, campaignId, userId, rewardName, coinAmount, membershipDays, operator, now }
}

function assertSameOperation(existing, input) {
  for (const field of ['grantId', 'campaignId', 'userId', 'rewardName', 'coinAmount', 'membershipDays']) {
    if (existing[field] !== input[field])
      throw new Error(`grantId 已被不同奖励占用: ${field}`)
  }
}

function rewardResult(operation, deduped = false) {
  return {
    grantId: operation.grantId,
    status: operation.status,
    ...(operation.coin ? { coin: operation.coin } : {}),
    ...(operation.membership ? { membership: operation.membership } : {}),
    ...(deduped ? { deduped: true } : {}),
  }
}

function correctionResult(correction, deduped = false) {
  return {
    correctionId: correction.correctionId,
    grantId: correction.grantId,
    status: correction.status,
    ...(correction.coin ? { coin: correction.coin } : {}),
    ...(correction.membership ? { membership: correction.membership } : {}),
    ...(deduped ? { deduped: true } : {}),
  }
}

async function assertRewardableUser(db, userId) {
  const classification = await classifyAccountIdentity(db, userId)
  if (classification.synthetic)
    throw new Error('受管测试身份不能领取运营奖励')
  const profile = await readProfileDoc(db, userId)
  if (!profile)
    throw new Error('用户不存在或尚未建立正式账户资料')
  if (profile.deletedAt)
    throw new Error('已注销账户不能领取奖励')
}

async function ensureCanonicalMembership(db, userId) {
  const canonicalRef = db.collection(MEMBERSHIPS_COLLECTION).doc(userId)
  const canonical = docData(await canonicalRef.get())
  if (canonical)
    return
  const legacy = await readMembership(db, userId)
  if (!legacy || legacy._id === userId)
    return
  const { _id: _legacyId, ...fields } = legacy
  await canonicalRef.set({ ...fields, userId })
}

async function grantMembershipReward(db, input) {
  await ensureCanonicalMembership(db, input.userId)
  const transactionId = stableId('membership_reward', input.grantId)
  let outcome
  await db.runTransaction(async (transaction) => {
    const entitlementRef = transaction
      .collection(MEMBERSHIP_ENTITLEMENT_TRANSACTIONS_COLLECTION)
      .doc(transactionId)
    const existing = docData(await entitlementRef.get())
    if (existing) {
      if (existing.userId !== input.userId
        || existing.grantId !== input.grantId
        || existing.days !== input.membershipDays) {
        throw new Error('会员奖励幂等键冲突')
      }
      outcome = {
        days: existing.days,
        expireBefore: existing.expireBefore,
        expireAfter: existing.expireAfter,
      }
      return
    }

    const membershipRef = transaction.collection(MEMBERSHIPS_COLLECTION).doc(input.userId)
    const membership = docData(await membershipRef.get())
    const expireBefore = Number.isFinite(membership?.expireAt) ? membership.expireAt : null
    const base = expireBefore && expireBefore > input.now ? expireBefore : input.now
    const expireAfter = base + input.membershipDays * DAY_MS
    const nextMembership = {
      userId: input.userId,
      level: membership?.level || membership?.planId || 'basic',
      activeCycle: membership?.activeCycle || 'reward',
      expireAt: expireAfter,
      lastRewardGrantId: input.grantId,
      ...(membership ? {} : { createdAt: input.now }),
      updatedAt: input.now,
    }
    if (membership)
      await membershipRef.update(nextMembership)
    else
      await membershipRef.set(nextMembership)

    await entitlementRef.set({
      userId: input.userId,
      type: 'reward',
      grantId: input.grantId,
      campaignId: input.campaignId,
      rewardName: input.rewardName,
      days: input.membershipDays,
      expireBefore,
      expireAfter,
      createdAt: input.now,
    })
    outcome = { days: input.membershipDays, expireBefore, expireAfter }
  })
  return outcome
}

async function correctMembershipReward(db, original, correctionInput) {
  const transactionId = stableId('membership_reward_correction', correctionInput.correctionId)
  let outcome
  await db.runTransaction(async (transaction) => {
    const entitlementRef = transaction
      .collection(MEMBERSHIP_ENTITLEMENT_TRANSACTIONS_COLLECTION)
      .doc(transactionId)
    const existing = docData(await entitlementRef.get())
    if (existing) {
      if (existing.userId !== original.userId
        || existing.originalGrantId !== original.grantId
        || existing.correctionId !== correctionInput.correctionId) {
        throw new Error('会员纠正幂等键冲突')
      }
      outcome = {
        status: existing.status,
        requestedDays: existing.requestedDays,
        recoveredDays: existing.recoveredDays,
        expireBefore: existing.expireBefore,
        expireAfter: existing.expireAfter,
      }
      return
    }

    const membershipRef = transaction.collection(MEMBERSHIPS_COLLECTION).doc(original.userId)
    const membership = docData(await membershipRef.get())
    const currentExpireAt = Number.isFinite(membership?.expireAt) ? membership.expireAt : null
    const expectedExpireAt = original.membership?.expireAfter
    if (!membership || currentExpireAt !== expectedExpireAt) {
      outcome = {
        status: 'manual_review_required',
        requestedDays: original.membershipDays,
        recoveredDays: 0,
        expireBefore: currentExpireAt,
        expireAfter: currentExpireAt,
      }
      await entitlementRef.set({
        userId: original.userId,
        type: 'reward_correction',
        status: outcome.status,
        correctionId: correctionInput.correctionId,
        originalGrantId: original.grantId,
        requestedDays: outcome.requestedDays,
        recoveredDays: 0,
        expireBefore: currentExpireAt,
        expireAfter: currentExpireAt,
        reason: correctionInput.reason,
        createdAt: correctionInput.now,
      })
      return
    }

    const remainingMs = Math.min(
      original.membershipDays * DAY_MS,
      Math.max(0, original.membership.expireAfter - correctionInput.now),
    )
    const expireAfter = currentExpireAt - remainingMs
    await membershipRef.update({
      expireAt: expireAfter,
      lastRewardCorrectionId: correctionInput.correctionId,
      updatedAt: correctionInput.now,
    })
    outcome = {
      status: 'completed',
      requestedDays: original.membershipDays,
      recoveredDays: remainingMs / DAY_MS,
      expireBefore: currentExpireAt,
      expireAfter,
    }
    await entitlementRef.set({
      userId: original.userId,
      type: 'reward_correction',
      status: outcome.status,
      correctionId: correctionInput.correctionId,
      originalGrantId: original.grantId,
      requestedDays: outcome.requestedDays,
      recoveredDays: outcome.recoveredDays,
      expireBefore: currentExpireAt,
      expireAfter,
      reason: correctionInput.reason,
      createdAt: correctionInput.now,
    })
  })
  return outcome
}

/**
 * 发放一笔 owner 奖励。每种资产都有独立稳定幂等键，允许部分失败后安全重试。
 */
async function grantReward(db, rawInput) {
  const input = normalizeRewardInput(rawInput)
  await assertRewardableUser(db, input.userId)

  const operationId = stableId('reward_operation', input.grantId)
  const operationRef = db.collection(REWARD_OPERATIONS_COLLECTION).doc(operationId)
  let operation
  await db.runTransaction(async (transaction) => {
    const ref = transaction.collection(REWARD_OPERATIONS_COLLECTION).doc(operationId)
    const existing = docData(await ref.get())
    if (existing) {
      assertSameOperation(existing, input)
      operation = existing
      return
    }
    operation = {
      grantId: input.grantId,
      campaignId: input.campaignId,
      userId: input.userId,
      rewardName: input.rewardName,
      coinAmount: input.coinAmount,
      membershipDays: input.membershipDays,
      operator: input.operator,
      status: 'processing',
      createdAt: input.now,
      updatedAt: input.now,
    }
    await ref.set(operation)
  })

  if (['completed', 'corrected', 'correction_pending_review'].includes(operation.status))
    return rewardResult(operation, true)

  if (input.coinAmount && !operation.coin) {
    const coin = await creditCoin(db, {
      userId: input.userId,
      appId: 'admin-rewards',
      amount: input.coinAmount,
      type: 'gift',
      refId: `reward:${input.grantId}:coin`,
      meta: {
        source: 'admin_reward',
        rewardName: input.rewardName,
        campaignId: input.campaignId,
        grantId: input.grantId,
      },
      now: input.now,
    })
    operation.coin = { amount: input.coinAmount, balanceAfter: coin.balance }
    await operationRef.update({ coin: operation.coin, updatedAt: input.now })
  }

  if (input.membershipDays && !operation.membership) {
    operation.membership = await grantMembershipReward(db, input)
    await operationRef.update({ membership: operation.membership, updatedAt: input.now })
  }

  await createRewardNotification(db, {
    userId: input.userId,
    grantId: input.grantId,
    rewardName: input.rewardName,
    coinAmount: input.coinAmount,
    membershipDays: input.membershipDays,
    now: input.now,
  })

  operation.status = 'completed'
  operation.completedAt = input.now
  operation.updatedAt = input.now
  await operationRef.update({
    status: operation.status,
    completedAt: operation.completedAt,
    updatedAt: operation.updatedAt,
  })
  return rewardResult(operation)
}

async function correctReward(db, rawInput) {
  if (!rawInput || typeof rawInput !== 'object')
    throw new Error('纠正参数必须为对象')
  const correctionId = assertIdentifier(rawInput.correctionId, 'correctionId')
  const grantId = assertIdentifier(rawInput.grantId, 'grantId')
  const reason = typeof rawInput.reason === 'string' ? rawInput.reason.trim() : ''
  const operator = typeof rawInput.operator === 'string' ? rawInput.operator.trim() : ''
  if (!reason)
    throw new Error('reason 必填')
  if (!operator)
    throw new Error('operator 必填')
  const now = Number(rawInput.now) || Date.now()

  const originalId = stableId('reward_operation', grantId)
  const originalRef = db.collection(REWARD_OPERATIONS_COLLECTION).doc(originalId)
  const original = docData(await originalRef.get())
  if (!original || !['completed', 'corrected', 'correction_pending_review'].includes(original.status))
    throw new Error('只能纠正已完成的奖励')
  if (original.correctionId && original.correctionId !== correctionId)
    throw new Error('该奖励已经创建纠正单')

  const correctionDocId = stableId('reward_correction', correctionId)
  const correctionRef = db.collection(REWARD_CORRECTIONS_COLLECTION).doc(correctionDocId)
  let correction = docData(await correctionRef.get())
  if (correction) {
    if (correction.grantId !== grantId
      || correction.reason !== reason
      || correction.operator !== operator) {
      throw new Error('correctionId 已被不同纠正操作占用')
    }
    if (['completed', 'manual_review_required'].includes(correction.status))
      return correctionResult(correction, true)
  }
  else {
    correction = {
      correctionId,
      grantId,
      campaignId: original.campaignId,
      userId: original.userId,
      rewardName: original.rewardName,
      reason,
      operator,
      status: 'processing',
      createdAt: now,
      updatedAt: now,
    }
    await correctionRef.set(correction)
  }

  if (original.coinAmount && !correction.coin) {
    const clawback = await clawbackCoin(db, {
      userId: original.userId,
      appId: 'admin-rewards',
      amount: original.coinAmount,
      refId: `reward-correction:${correctionId}:coin`,
      meta: {
        source: 'admin_reward_correction',
        rewardCorrection: true,
        rewardName: original.rewardName,
        campaignId: original.campaignId,
        grantId,
        correctionId,
      },
      now,
    })
    correction.coin = {
      requested: original.coinAmount,
      recovered: clawback.clawed,
      shortfall: original.coinAmount - clawback.clawed,
      balanceAfter: clawback.balance,
    }
    await correctionRef.update({ coin: correction.coin, updatedAt: now })
  }

  if (original.membershipDays && !correction.membership) {
    correction.membership = await correctMembershipReward(db, original, {
      correctionId,
      reason,
      now,
    })
    await correctionRef.update({ membership: correction.membership, updatedAt: now })
  }

  correction.status = correction.membership?.status === 'manual_review_required'
    ? 'manual_review_required'
    : 'completed'
  correction.completedAt = now
  correction.updatedAt = now
  await correctionRef.update({ status: correction.status, completedAt: now, updatedAt: now })
  await originalRef.update({
    status: correction.status === 'completed' ? 'corrected' : 'correction_pending_review',
    correctionId,
    correctedAt: now,
    correction: {
      coin: correction.coin,
      membership: correction.membership,
    },
    updatedAt: now,
  })
  return correctionResult(correction)
}

async function listRewardHistory(db, { userId, skip = 0, limit = 20 }) {
  const uid = assertUserId(userId)
  const n = Math.min(Math.max(Number(limit) || 20, 1), 50)
  const s = Math.max(Number(skip) || 0, 0)
  const { data } = await db
    .collection(REWARD_OPERATIONS_COLLECTION)
    .where({ userId: uid })
    .orderBy('completedAt', 'desc')
    .skip(s)
    .limit(n)
    .get()
  const rows = (Array.isArray(data) ? data : [])
    .filter(row => ['completed', 'corrected', 'correction_pending_review'].includes(row.status))
  return {
    items: rows.map(row => ({
      grantId: row.grantId,
      rewardName: row.rewardName,
      coinAmount: row.coinAmount || 0,
      membershipDays: row.membershipDays || 0,
      status: row.status,
      creditedAt: row.completedAt,
      correction: row.correction
        ? {
            correctedAt: row.correctedAt,
            ...(row.correction.coin ? { coin: row.correction.coin } : {}),
            ...(row.correction.membership ? { membership: row.correction.membership } : {}),
          }
        : null,
    })),
    nextSkip: rows.length === n ? s + n : null,
  }
}

module.exports = {
  FIXED_COIN_REWARD,
  FIXED_MEMBERSHIP_DAYS,
  MEMBERSHIP_ENTITLEMENT_TRANSACTIONS_COLLECTION,
  REWARD_CORRECTIONS_COLLECTION,
  REWARD_OPERATIONS_COLLECTION,
  correctReward,
  grantReward,
  listRewardHistory,
}

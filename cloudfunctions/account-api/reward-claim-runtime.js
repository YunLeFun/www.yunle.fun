/** Production dependency assembly for reward-claim campaigns inside account-api. */

'use strict'

const process = require('node:process')

const { assertAccountActionAllowed } = require('./account-access')
const { readProfileDoc, resolvePublicNickname } = require('./profiles')
const { createRewardClaimCampaignService } = require('./reward-claim-campaigns')
const {
  createCloudbaseRewardClaimRateLimit,
  createCloudbaseRewardClaimStore,
} = require('./reward-claim-cloudbase')
const {
  createRewardClaimRateTicket,
  createRewardClaimTokenPort,
  publicLinkDigest,
} = require('./reward-claim-security')
const { correctReward, getRewardOperation, grantReward } = require('./rewards')
const { classifyAccountIdentity } = require('./synthetic')

function createRewardClaimRuntime(db, options = {}) {
  const env = options.env || process.env
  const currentTime = options.now || Date.now
  const token = createRewardClaimTokenPort({
    hashKey: env.REWARD_CLAIM_LINK_HASH_KEY,
    siteUrl: env.REWARD_CLAIM_SITE_URL || 'https://www.yunle.fun',
    randomBytes: options.randomBytes,
  })
  const rateTicketCore = createRewardClaimRateTicket({
    secret: env.REWARD_CLAIM_RATE_TICKET_SECRET,
    linkHashKey: env.REWARD_CLAIM_LINK_HASH_KEY,
    now: currentTime,
    randomBytes: options.randomBytes,
  })
  const rateTicket = {
    verify: (ticket, input) => rateTicketCore.verify(ticket, input),
    issueForRequest({ rawToken, ip }) {
      return rateTicketCore.issue({
        linkDigest: publicLinkDigest(rawToken),
        ip,
      })
    },
  }
  const store = createCloudbaseRewardClaimStore(db, options.transaction)
  const rateLimit = createCloudbaseRewardClaimRateLimit(db, options.rateLimit)
  const eligibility = {
    async inspect(userId) {
      try {
        await assertAccountActionAllowed(db, {
          userId,
          action: 'claimRewardCampaign',
          now: currentTime(),
        })
        const classification = await classifyAccountIdentity(db, userId)
        if (classification.synthetic)
          return { eligible: false, message: '受管测试身份不能领取运营奖励' }
        const profile = await readProfileDoc(db, userId)
        if (profile?.deletedAt)
          return { eligible: false, message: '用户不存在或账户已注销' }
        return {
          eligible: true,
          nickname: resolvePublicNickname(profile?.nickname, userId),
        }
      }
      catch (error) {
        return {
          eligible: false,
          message: error instanceof Error ? error.message : '当前账户不能领取该奖励',
        }
      }
    },
  }
  const reward = {
    async grant(input) {
      // 领取入口已用当前登录 uid 完成账号状态与 synthetic 身份校验；资料缓存
      // 可能因首次登录同步延迟而暂缺，不应再次以缓存存在性阻断奖励结算。
      const result = await grantReward(
        db,
        { ...input, now: currentTime() },
        { allowMissingProfile: true },
      )
      if (result.status !== 'completed') {
        return {
          kind: 'unknown',
          code: 'reward_not_completed',
          message: `奖励操作状态为 ${String(result.status)}`,
        }
      }
      return {
        kind: 'completed',
        grantId: result.grantId,
        ...(Number.isFinite(result.coin?.balanceAfter)
          ? { balanceAfter: result.coin.balanceAfter }
          : {}),
      }
    },
    async inspect(grantId) {
      const operation = await getRewardOperation(db, grantId)
      if (!operation)
        return { kind: 'absent' }
      if (operation.grantId !== grantId)
        return { kind: 'conflict' }
      if (operation.status === 'completed') {
        return {
          kind: 'completed',
          grantId,
          ...(Number.isFinite(operation.coin?.balanceAfter)
            ? { balanceAfter: operation.coin.balanceAfter }
            : {}),
        }
      }
      if (operation.status === 'processing')
        return { kind: 'processing' }
      return { kind: 'conflict' }
    },
    correct: input => correctReward(db, { ...input, now: currentTime() }),
  }
  const service = createRewardClaimCampaignService({
    store,
    token,
    rateTicket,
    rateLimit,
    eligibility,
    reward,
    now: currentTime,
    membershipHighThresholdDays: Number(env.REWARD_CLAIM_MEMBERSHIP_HIGH_THRESHOLD_DAYS) || 3650,
  })

  return {
    service,
    store,
    token,
    rateTicket,
    rateLimit,
  }
}

module.exports = {
  createRewardClaimRuntime,
}

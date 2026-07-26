import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import controlToken from '../../cloudfunctions/account-api/reward-control-token.js'

const CURRENT = Buffer.alloc(32, 7).toString('base64')
const PREVIOUS = Buffer.alloc(32, 6).toString('base64')

describe('奖励控制面独立 token', () => {
  it('允许 current/previous 平滑轮换并使用常量时间比较', () => {
    const tokens = [Buffer.from(CURRENT, 'base64'), Buffer.from(PREVIOUS, 'base64')]
    expect(() => controlToken.assertRewardControlToken({
      action: 'adminGrantReward',
      rewardControlToken: CURRENT,
    }, { tokens })).not.toThrow()
    expect(() => controlToken.assertRewardControlToken({
      action: 'adminCorrectReward',
      rewardControlToken: PREVIOUS,
    }, { tokens })).not.toThrow()
  })

  it('拒绝错误 token、白名单外 action 和超过两枚的配置', () => {
    const tokens = [Buffer.from(CURRENT, 'base64')]
    expect(() => controlToken.assertRewardControlToken({
      action: 'adminGrantReward',
      rewardControlToken: Buffer.alloc(32, 8).toString('base64'),
    }, { tokens })).toThrow(/鉴权失败/)
    expect(() => controlToken.assertRewardControlToken({
      action: 'adminAdjustCoin',
      rewardControlToken: CURRENT,
    }, { tokens })).toThrow(/action 不被允许/)
    expect(() => controlToken.parseRewardControlTokens(JSON.stringify({
      current: CURRENT,
      previous: PREVIOUS,
      extra: Buffer.alloc(32, 5).toString('base64'),
    }))).toThrow(/仅允许/)
  })
})

import { describe, expect, it } from 'vitest'

import { deductCoinForUid, getAccountForUid } from '../../cloudfunctions/desktop-auth/lib/account-proxy.js'

const TOKEN = 'internal-token'

function fakeCaller(returnValue = {}) {
  const calls = []
  const call = async (data) => {
    calls.push(data)
    return returnValue
  }
  return { call, calls }
}

describe('account-proxy', () => {
  it('getAccountForUid 转调 account-api getAccountForUser，带 serviceToken+userId', async () => {
    const { call, calls } = fakeCaller({ coin: 12, membership: { isActive: true } })
    const res = await getAccountForUid(call, { serviceToken: TOKEN, userId: 'u1' })
    expect(res).toEqual({ coin: 12, membership: { isActive: true } })
    expect(calls[0]).toEqual({ action: 'getAccountForUser', serviceToken: TOKEN, userId: 'u1' })
  })

  it('deductCoinForUid 转调 deductCoinForUser，透传 appId/amount/bizId/meta', async () => {
    const { call, calls } = fakeCaller({ balance: 50, deduped: false })
    const res = await deductCoinForUid(call, { serviceToken: TOKEN, userId: 'u1', appId: 'skykeeper', amount: 50, bizId: 'export:1', meta: { f: 'hd' } })
    expect(res).toEqual({ balance: 50, deduped: false })
    expect(calls[0]).toEqual({
      action: 'deductCoinForUser',
      serviceToken: TOKEN,
      userId: 'u1',
      appId: 'skykeeper',
      amount: 50,
      bizId: 'export:1',
      meta: { f: 'hd' },
    })
  })

  it('缺 serviceToken → 抛错（不发起调用）', async () => {
    const { call, calls } = fakeCaller()
    await expect(getAccountForUid(call, { serviceToken: '', userId: 'u1' })).rejects.toThrow(/鉴权未配置/)
    await expect(deductCoinForUid(call, { serviceToken: '', userId: 'u1', appId: 'x', amount: 1 })).rejects.toThrow(/鉴权未配置/)
    expect(calls).toHaveLength(0)
  })
})

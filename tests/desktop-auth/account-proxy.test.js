import { describe, expect, it, vi } from 'vitest'

import {
  assertActiveAccountForUid,
  getAccountAccessForUid,
  getAccountForUid,
} from '../../cloudfunctions/desktop-auth/lib/account-proxy.js'

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

  it('缺 serviceToken → 抛错（不发起调用）', async () => {
    const { call, calls } = fakeCaller()
    await expect(getAccountForUid(call, { serviceToken: '', userId: 'u1' })).rejects.toThrow(/鉴权未配置/)
    expect(calls).toHaveLength(0)
  })

  it('访问状态代理使用独立只读 action，并对受限账号失败关闭', async () => {
    const { call, calls } = fakeCaller({
      state: 'deletion_pending',
      restricted: true,
      recoverable: true,
    })

    await expect(getAccountAccessForUid(call, { serviceToken: TOKEN, userId: 'u1' }))
      .resolves
      .toMatchObject({ state: 'deletion_pending' })
    expect(calls[0]).toEqual({
      action: 'getAccountAccessForUser',
      serviceToken: TOKEN,
      userId: 'u1',
    })

    await expect(assertActiveAccountForUid(call, { serviceToken: TOKEN, userId: 'u1' }))
      .rejects
      .toMatchObject({ code: 'account_deletion_pending' })
  })

  it('访问状态服务异常时不放行业务动作', async () => {
    const call = vi.fn(async () => {
      throw new Error('account-api unavailable')
    })
    await expect(assertActiveAccountForUid(call, { serviceToken: TOKEN, userId: 'u1' }))
      .rejects
      .toThrow(/account-api unavailable/)
  })
})

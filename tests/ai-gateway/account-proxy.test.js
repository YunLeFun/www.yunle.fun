import { describe, expect, it, vi } from 'vitest'

import { deductSyntheticCoinForUid } from '../../cloudfunctions/ai-gateway/lib/account-proxy.js'

describe('ai-gateway synthetic account proxy', () => {
  it('uses the dedicated trusted action and does not accept caller metadata', async () => {
    const call = vi.fn(async () => ({ balance: 1, deduped: false }))
    const result = await deductSyntheticCoinForUid(call, {
      serviceToken: 'ai-gateway-token',
      userId: 'test_uid_01',
      appId: 'everything-generator',
      amount: 1,
      bizId: 'wish:req-01:audit',
      reservationId: 'reservation_01',
      syntheticLeaseId: 'lease_01',
      syntheticScopeId: 'wish',
      meta: { synthetic: false, injected: true },
    })

    expect(result).toEqual({ balance: 1, deduped: false })
    expect(call).toHaveBeenCalledWith({
      action: 'deductSyntheticCoinForUser',
      serviceToken: 'ai-gateway-token',
      userId: 'test_uid_01',
      appId: 'everything-generator',
      amount: 1,
      bizId: 'wish:req-01:audit',
      reservationId: 'reservation_01',
      syntheticLeaseId: 'lease_01',
      syntheticScopeId: 'wish',
    })
  })

  it('fails before calling account-api when its dedicated token is missing', async () => {
    const call = vi.fn()
    await expect(deductSyntheticCoinForUid(call, { serviceToken: '' })).rejects.toThrow(/鉴权未配置/)
    expect(call).not.toHaveBeenCalled()
  })
})

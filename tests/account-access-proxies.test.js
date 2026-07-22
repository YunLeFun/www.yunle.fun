import { describe, expect, it } from 'vitest'

import * as github from '../cloudfunctions/github-api/account-access.js'
import * as iap from '../cloudfunctions/iap-order/account-access.js'
import * as sso from '../cloudfunctions/sso-ticket/account-access.js'
import * as storage from '../cloudfunctions/user-storage-api/account-access.js'
import * as wxpay from '../cloudfunctions/wxpay-order/account-access.js'

const TOKEN = 'account-access-service-token'
const clients = [
  ['github-api', github],
  ['user-storage-api', storage],
  ['sso-ticket', sso],
  ['wxpay-order', wxpay],
  ['iap-order', iap],
]

describe.each(clients)('%s account access proxy', (_name, client) => {
  it('使用内部状态 action 并放行 active', async () => {
    const calls = []
    const call = async (data) => {
      calls.push(data)
      return { state: 'active', restricted: false }
    }

    await expect(client.assertActiveAccountForUid(call, {
      serviceToken: TOKEN,
      userId: 'u1',
    })).resolves.toMatchObject({ state: 'active' })
    expect(calls).toEqual([{
      action: 'getAccountAccessForUser',
      serviceToken: TOKEN,
      userId: 'u1',
    }])
  })

  it('拒绝待注销、最终清理和管理员封禁', async () => {
    for (const [state, code] of [
      ['deletion_pending', 'account_deletion_pending'],
      ['deletion_finalizing', 'account_deletion_finalizing'],
      ['admin_banned', 'account_banned'],
    ]) {
      const call = async () => ({ state, restricted: true })
      await expect(client.assertActiveAccountForUid(call, { serviceToken: TOKEN, userId: 'u1' }))
        .rejects
        .toMatchObject({ code, state })
    }
  })
})

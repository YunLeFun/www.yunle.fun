import type {
  RewardClaimCampaignView,
  RewardClaimResult,
} from '~/types/reward-claim'

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

async function publicTokenDigest(token: string) {
  if (!globalThis.crypto?.subtle)
    throw new Error('当前浏览器不支持安全领取，请升级浏览器后重试')
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  )
  return bytesToHex(new Uint8Array(digest))
}

export function useRewardClaim() {
  const { app } = useCloudbase()
  const coin = useCoin()
  const loading = ref(false)
  const claiming = ref(false)

  async function inspect(token: string): Promise<RewardClaimCampaignView> {
    if (!app)
      throw new Error('领取服务暂不可用')
    loading.value = true
    try {
      const response = await app.callFunction({
        name: 'account-api',
        data: {
          action: 'getRewardClaimCampaign',
          token,
        },
      })
      return response.result as RewardClaimCampaignView
    }
    finally {
      loading.value = false
    }
  }

  async function claim(token: string): Promise<RewardClaimResult> {
    if (!app)
      throw new Error('领取服务暂不可用')
    claiming.value = true
    try {
      const linkDigest = await publicTokenDigest(token)
      const ticket = await $fetch<{ rateTicket: string }>('/api/reward-claims/rate-ticket', {
        method: 'POST',
        body: { linkDigest },
      })
      const response = await app.callFunction({
        name: 'account-api',
        data: {
          action: 'claimRewardCampaign',
          token,
          rateTicket: ticket.rateTicket,
        },
      })
      const result = response.result as RewardClaimResult
      if (result.status === 'succeeded')
        await coin.refresh()
      return result
    }
    finally {
      claiming.value = false
    }
  }

  return {
    loading: readonly(loading),
    claiming: readonly(claiming),
    inspect,
    claim,
  }
}

import type { AiPointExchangePolicy, AiPointExchangeResult } from '~/types/ai-points'
import { useSessionStorage } from '@vueuse/core'

interface ExchangeIntent {
  userId: string
  coinAmount: number
  pointsPerCoin: number
  idempotencyKey: string
}

export function useAiPointExchange() {
  const { app } = useCloudbase()
  const { user } = useTcbAuth()
  const coin = useCoin()
  const policy = shallowRef<AiPointExchangePolicy | null>(null)
  const loading = shallowRef(false)
  const submitting = shallowRef(false)
  const error = shallowRef('')
  // 刷新或切换资产后仍可重试同一笔请求，不因响应丢失而重新扣款。
  const storedIntent = useSessionStorage<ExchangeIntent | null>('wallet-ai-point-exchange', null, {
    serializer: { read: JSON.parse, write: JSON.stringify },
  })
  const pending = computed(() => storedIntent.value?.userId === user.value?.id ? storedIntent.value : null)
  let epoch = 0

  async function refresh() {
    if (!user.value || !app)
      return
    const requestEpoch = ++epoch
    const userId = user.value.id
    loading.value = true
    error.value = ''
    try {
      const response = await app.callFunction({ name: 'account-api', data: { action: 'getAiPointExchangePolicy' } })
      if (requestEpoch !== epoch || user.value?.id !== userId)
        return
      const value = response.result as AiPointExchangePolicy
      if (typeof value?.enabled !== 'boolean' || !Number.isSafeInteger(value.pointsPerCoin) || value.pointsPerCoin <= 0
        || !Number.isSafeInteger(value.minCoin) || value.minCoin < 1 || !Number.isSafeInteger(value.maxCoin) || value.maxCoin < value.minCoin) {
        throw new Error('兑换规则暂不可用')
      }
      policy.value = value
    }
    catch {
      if (requestEpoch === epoch) {
        policy.value = null
        error.value = '兑换服务暂不可用，请稍后重试。'
      }
    }
    finally {
      if (requestEpoch === epoch)
        loading.value = false
    }
  }

  async function exchange(coinAmount: number, pointsPerCoin: number): Promise<AiPointExchangeResult | null> {
    if (submitting.value || !app || !user.value)
      return null
    const userId = user.value.id
    const intent = pending.value ?? { userId, coinAmount, pointsPerCoin, idempotencyKey: crypto.randomUUID() }
    storedIntent.value = intent
    submitting.value = true
    error.value = ''
    try {
      const response = await app.callFunction({
        name: 'account-api',
        data: { action: 'exchangeCoinForAiPoints', coinAmount: intent.coinAmount, pointsPerCoin: intent.pointsPerCoin, idempotencyKey: intent.idempotencyKey },
      })
      if (user.value?.id !== userId)
        return null
      const result = response.result as AiPointExchangeResult | { rejected: true, message: string }
      if ('rejected' in result) {
        storedIntent.value = null
        await Promise.all([refresh(), coin.refresh()])
        error.value = result.message
        return null
      }
      if (!result.exchangeId || !Number.isSafeInteger(result.creditedMicroPoints) || !Number.isSafeInteger(result.coinBalance))
        throw new Error('兑换结果无效')
      storedIntent.value = null
      await coin.refresh()
      return user.value?.id === userId ? result : null
    }
    catch {
      if (user.value?.id === userId)
        error.value = '兑换结果暂未确认，请重试本次兑换。重复重试不会重复扣币。'
      return null
    }
    finally {
      submitting.value = false
    }
  }

  watch(() => user.value?.id, () => {
    epoch += 1
    policy.value = null
    error.value = ''
    loading.value = false
  })

  return { policy: readonly(policy), loading: readonly(loading), submitting: readonly(submitting), error: readonly(error), pending, refresh, exchange }
}

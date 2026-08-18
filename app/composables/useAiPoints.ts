import type {
  AiPointAccount,
  AiPointAccountResponse,
  AiPointTransaction,
  AiPointTransactionPage,
} from '~/types/ai-points'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '获取 AI 点数失败'
}

export function useAiPoints() {
  const { app } = useCloudbase()
  const { user } = useTcbAuth()
  const account = shallowRef<AiPointAccount | null>(null)
  const transactions = shallowRef<AiPointTransaction[]>([])
  const nextCursor = shallowRef<string | null>(null)
  const loading = shallowRef(false)
  const loadingMore = shallowRef(false)
  const error = shallowRef<string | null>(null)
  const hasMore = computed(() => nextCursor.value !== null)
  let requestEpoch = 0

  function reset() {
    requestEpoch += 1
    account.value = null
    transactions.value = []
    nextCursor.value = null
    loading.value = false
    loadingMore.value = false
    error.value = null
  }

  async function refresh(): Promise<void> {
    if (!user.value || !app) {
      reset()
      return
    }
    if (loading.value)
      return
    const epoch = ++requestEpoch
    const requestedUserId = user.value.id
    loading.value = true
    loadingMore.value = false
    error.value = null
    try {
      const [accountResult, transactionResult] = await Promise.all([
        app.callFunction({
          name: 'account-api',
          data: { action: 'getMyAiPointAccount' },
        }),
        app.callFunction({
          name: 'account-api',
          data: { action: 'listMyAiPointTransactions', limit: 20 },
        }),
      ])
      if (epoch !== requestEpoch || user.value?.id !== requestedUserId)
        return
      const accountResponse = accountResult.result as AiPointAccountResponse
      const transactionPage = transactionResult.result as AiPointTransactionPage
      account.value = accountResponse.account
      transactions.value = transactionPage.items
      nextCursor.value = transactionPage.nextCursor
    }
    catch (caught) {
      if (epoch === requestEpoch)
        error.value = errorMessage(caught)
    }
    finally {
      if (epoch === requestEpoch)
        loading.value = false
    }
  }

  async function loadMore(): Promise<void> {
    if (!user.value || !app || !nextCursor.value || loadingMore.value)
      return
    const epoch = requestEpoch
    const requestedUserId = user.value.id
    const cursor = nextCursor.value
    loadingMore.value = true
    error.value = null
    try {
      const result = await app.callFunction({
        name: 'account-api',
        data: {
          action: 'listMyAiPointTransactions',
          cursor,
          limit: 20,
        },
      })
      if (epoch !== requestEpoch || user.value?.id !== requestedUserId)
        return
      const page = result.result as AiPointTransactionPage
      transactions.value = [...transactions.value, ...page.items]
      nextCursor.value = page.nextCursor
    }
    catch (caught) {
      if (epoch === requestEpoch)
        error.value = errorMessage(caught)
    }
    finally {
      if (epoch === requestEpoch)
        loadingMore.value = false
    }
  }

  watch(() => user.value?.id, (current, previous) => {
    if (current === previous)
      return
    reset()
    if (current)
      void refresh()
  })

  return {
    account: readonly(account),
    transactions: readonly(transactions),
    loading: readonly(loading),
    loadingMore: readonly(loadingMore),
    error: readonly(error),
    hasMore: readonly(hasMore),
    refresh,
    loadMore,
  }
}

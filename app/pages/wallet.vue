<script setup lang="ts">
import type { CoinPackId, CoinTransaction } from '~/types/payment'
import { COIN_TX_TYPE_NAMES } from '~/composables/useCoin'
import { formatPrice } from '~/composables/usePaymentFlow'
import { COIN_PACKS } from '~/types/payment'

useSeoMeta({
  title: '我的钱包',
  description: '云币余额、充值与消费记录',
})

const { user } = useTcbAuth()
const coin = useCoin()
const recharge = useCoinRecharge()

const showModal = ref(false)

// 充值包列表（来自共享类型，保证与服务端一致）
const packs = computed(() =>
  (Object.keys(COIN_PACKS) as CoinPackId[]).map(id => ({
    id,
    coin: COIN_PACKS[id].coin,
    amount: COIN_PACKS[id].amount,
  })),
)

// 流水
const transactions = ref<CoinTransaction[]>([])
const txLoading = ref(false)
const nextSkip = ref<number | null>(0)
const hasMore = computed(() => nextSkip.value !== null)

async function loadTransactions(reset = false) {
  if (txLoading.value)
    return
  if (reset) {
    transactions.value = []
    nextSkip.value = 0
  }
  if (nextSkip.value === null)
    return
  txLoading.value = true
  try {
    const { items, nextSkip: ns } = await coin.listTransactions({ skip: nextSkip.value, limit: 20 })
    transactions.value.push(...items)
    nextSkip.value = ns
  }
  finally {
    txLoading.value = false
  }
}

function handleRecharge(packId: CoinPackId) {
  if (!user.value) {
    navigateTo('/login?redirect=/wallet')
    return
  }
  recharge.selectPack(packId)
  showModal.value = true
}

function handleConfirm() {
  recharge.createOrder()
}

function handleClose() {
  showModal.value = false
  const wasSuccess = recharge.phase.value === 'success'
  recharge.reset()
  if (wasSuccess) {
    coin.refresh()
    loadTransactions(true)
  }
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatExpire(ts: number | null): string {
  if (!ts)
    return '—'
  return new Date(ts).toLocaleDateString('zh-CN')
}

onMounted(() => {
  if (user.value) {
    coin.refresh()
    loadTransactions(true)
  }
  // H5 跳转回来后恢复充值结果
  const resumed = recharge.resumePending()
  if (resumed)
    showModal.value = true
})
</script>

<template>
  <UContainer class="py-8 space-y-8">
    <h1 class="text-2xl font-bold">
      我的钱包
    </h1>

    <!-- 未登录 -->
    <UCard
      v-if="!user"
      class="ylf-surface"
    >
      <div class="text-center py-8 space-y-4">
        <UIcon name="i-lucide-wallet" class="w-12 h-12 mx-auto text-muted" />
        <p class="text-muted">
          登录后查看云币余额与充值记录
        </p>
        <UButton to="/login?redirect=/wallet">
          去登录
        </UButton>
      </div>
    </UCard>

    <template v-else>
      <!-- 余额 + 会员状态 -->
      <div class="grid sm:grid-cols-2 gap-4">
        <UCard class="ylf-surface">
          <div class="space-y-1">
            <p class="text-sm text-muted">
              云币余额
            </p>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-coins" class="w-7 h-7 text-primary" />
              <span class="text-3xl font-bold">{{ coin.balance.value }}</span>
              <span class="text-muted">云币</span>
            </div>
          </div>
        </UCard>

        <UCard class="ylf-surface">
          <div class="space-y-1">
            <p class="text-sm text-muted">
              云乐坊会员
            </p>
            <div class="flex items-center gap-2">
              <UIcon
                name="i-lucide-crown"
                class="w-7 h-7"
                :class="coin.isMember.value ? 'text-warning' : 'text-muted'"
              />
              <span class="text-lg font-semibold">
                {{ coin.isMember.value ? '会员有效' : '未开通' }}
              </span>
              <UBadge v-if="coin.isMember.value" color="warning" variant="subtle">
                至 {{ formatExpire(coin.membership.value?.expireAt ?? null) }}
              </UBadge>
            </div>
            <div class="pt-2">
              <UButton to="/pricing" size="xs" variant="outline" color="neutral">
                {{ coin.isMember.value ? '续费会员' : '开通会员' }}
              </UButton>
            </div>
          </div>
        </UCard>
      </div>

      <!-- 充值包 -->
      <section class="space-y-4">
        <h2 class="text-lg font-semibold">
          云币充值
        </h2>
        <p class="text-sm text-muted">
          100 云币 = 10 元；云币为平台虚拟消费凭证，不可提现。
        </p>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <button
            v-for="pack in packs"
            :key="pack.id"
            type="button"
            class="ylf-interactive-card rounded-lg p-4 text-left"
            @click="handleRecharge(pack.id)"
          >
            <div class="text-center space-y-2 py-2">
              <UIcon name="i-lucide-coins" class="w-8 h-8 mx-auto text-primary" />
              <div class="text-xl font-bold">
                {{ pack.coin }}
              </div>
              <div class="text-sm text-muted">
                云币
              </div>
              <div class="text-primary font-semibold">
                {{ formatPrice(pack.amount) }}
              </div>
            </div>
          </button>
        </div>
      </section>

      <!-- 流水 -->
      <section class="space-y-4">
        <h2 class="text-lg font-semibold">
          云币明细
        </h2>

        <div v-if="transactions.length === 0 && !txLoading" class="ylf-empty-state rounded-lg py-8 text-center text-muted">
          暂无记录
        </div>

        <div v-else class="divide-y divide-default rounded-xl border border-default">
          <div
            v-for="tx in transactions"
            :key="tx._id"
            class="flex items-center justify-between px-4 py-3"
          >
            <div class="space-y-0.5">
              <div class="flex items-center gap-2">
                <span class="font-medium">{{ COIN_TX_TYPE_NAMES[tx.type] }}</span>
                <UBadge v-if="tx.appId" color="neutral" variant="subtle" size="sm">
                  {{ tx.appId }}
                </UBadge>
              </div>
              <div class="text-xs text-muted">
                {{ formatDate(tx.createdAt) }}
              </div>
            </div>
            <div class="text-right">
              <div
                class="font-semibold"
                :class="tx.amount >= 0 ? 'text-success' : 'text-highlighted'"
              >
                {{ tx.amount >= 0 ? '+' : '' }}{{ tx.amount }}
              </div>
              <div class="text-xs text-muted">
                余额 {{ tx.balanceAfter }}
              </div>
            </div>
          </div>
        </div>

        <div v-if="hasMore" class="text-center">
          <UButton
            variant="outline"
            color="neutral"
            size="sm"
            :loading="txLoading"
            @click="loadTransactions()"
          >
            加载更多
          </UButton>
        </div>
      </section>
    </template>

    <!-- 充值弹窗 -->
    <CoinRechargeModal
      v-model:open="showModal"
      :coin="recharge.selectedCoin.value"
      :price="recharge.selectedPrice.value"
      :phase="recharge.phase.value"
      :loading="recharge.loading.value"
      :error-message="recharge.errorMessage.value"
      :code-url="recharge.currentOrder.value?.codeUrl"
      @confirm="handleConfirm"
      @close="handleClose"
    />
  </UContainer>
</template>

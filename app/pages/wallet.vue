<script setup lang="ts">
import type { OrderSummary } from '~/composables/useCoin'
import type { CoinPackId, CoinTransaction } from '~/types/payment'
import { COIN_TX_TYPE_NAMES } from '~/composables/useCoin'
import { formatPrice } from '~/composables/usePaymentFlow'
import { COIN_CUSTOM_MAX, COIN_CUSTOM_MIN, COIN_PACKS, COIN_RATE_FEN } from '~/types/payment'

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
  (Object.keys(COIN_PACKS) as CoinPackId[]).map((id, index) => ({
    id,
    coin: COIN_PACKS[id].coin,
    amount: COIN_PACKS[id].amount,
    // 标记一个推荐档位，提升转化引导
    popular: index === 1,
  })),
)

// 自定义充值额度
const customCoin = ref<number | null>(null)
const quickAddOptions = [100, 500, 1000, 5000]

const customError = computed(() => {
  const v = customCoin.value
  if (v == null || Number.isNaN(v))
    return ''
  if (!Number.isInteger(v))
    return '请输入整数云币'
  if (v < COIN_CUSTOM_MIN)
    return `最少充值 ${COIN_CUSTOM_MIN} 云币`
  if (v > COIN_CUSTOM_MAX)
    return `单次最多 ${COIN_CUSTOM_MAX.toLocaleString()} 云币`
  return ''
})
const customValid = computed(() =>
  customCoin.value != null && customCoin.value > 0 && !customError.value,
)
const customPrice = computed(() =>
  customValid.value ? (customCoin.value as number) * COIN_RATE_FEN : 0,
)

function quickFill(v: number) {
  customCoin.value = v
}

function handleCustomRecharge() {
  if (!customValid.value)
    return
  if (!user.value) {
    navigateTo('/login?redirect=/wallet')
    return
  }
  recharge.selectCustom(customCoin.value as number)
  showModal.value = true
}

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

// 订单历史
const orders = ref<OrderSummary[]>([])
const orderLoading = ref(false)
const orderNextSkip = ref<number | null>(0)
const orderHasMore = computed(() => orderNextSkip.value !== null)

async function loadOrders(reset = false) {
  if (orderLoading.value)
    return
  if (reset) {
    orders.value = []
    orderNextSkip.value = 0
  }
  if (orderNextSkip.value === null)
    return
  orderLoading.value = true
  try {
    const { items, nextSkip } = await coin.listOrders({ skip: orderNextSkip.value, limit: 10 })
    orders.value.push(...items)
    orderNextSkip.value = nextSkip
  }
  catch (err) {
    // 后端 listOrders 暂不可用时优雅降级为空，不拖垮整页
    console.warn('[wallet] listOrders failed:', err)
    orderNextSkip.value = null
  }
  finally {
    orderLoading.value = false
  }
}

const ORDER_STATUS: Record<string, { label: string, color: 'warning' | 'success' | 'neutral' | 'error' }> = {
  pending: { label: '待支付', color: 'warning' },
  paid: { label: '已支付', color: 'success' },
  failed: { label: '已失败', color: 'neutral' },
  refunded: { label: '已退款', color: 'error' },
  closed: { label: '已关闭', color: 'neutral' },
}
function orderStatusMeta(status: string) {
  return ORDER_STATUS[status] ?? { label: status, color: 'neutral' as const }
}

function orderTitle(o: OrderSummary): string {
  if (o.orderType === 'membership') {
    const cycle = o.billingCycle === 'month' ? '月付' : o.billingCycle === 'year' ? '年付' : ''
    return `${o.level ? `${o.level} ` : ''}会员${cycle ? ` · ${cycle}` : ''}`
  }
  if (o.orderType === 'recharge_coin')
    return `云币充值${o.coinAmount ? ` ${o.coinAmount} 云币` : ''}`
  return '订单'
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

/** 会员剩余天数（向上取整）；非会员返回 null */
const memberDaysLeft = computed(() => {
  const expireAt = coin.membership.value?.expireAt
  if (!coin.isMember.value || !expireAt)
    return null
  return Math.max(0, Math.ceil((expireAt - Date.now()) / (24 * 60 * 60 * 1000)))
})
/** 会员即将到期（7 天内）—— 触发主动续费提醒 */
const memberExpiringSoon = computed(() => memberDaysLeft.value != null && memberDaysLeft.value <= 7)

onMounted(async () => {
  if (user.value) {
    // 先兜底对账：把支付成功却卡在 pending（轮询窗口已关 / 回调漏达）的订单补发，
    // 再刷新余额与流水，避免「付了款余额不变」。
    const { paid } = await coin.reconcileOrders()
    await Promise.all([coin.refresh(), loadTransactions(true), loadOrders(true)])
    if (paid > 0)
      useToast().add({ title: '已为你补发到账', description: `${paid} 笔支付已确认入账`, color: 'success' })
  }
  // H5 跳转回来后恢复充值结果
  const resumed = recharge.resumePending()
  if (resumed)
    showModal.value = true
})
</script>

<template>
  <UContainer class="py-8 sm:py-10 space-y-8">
    <header class="space-y-1">
      <h1 class="text-2xl font-bold tracking-tight">
        我的钱包
      </h1>
      <p class="text-sm text-muted">
        管理你的云币余额、充值与消费记录
      </p>
    </header>

    <!-- 未登录 -->
    <div
      v-if="!user"
      class="ylf-empty-state rounded-2xl px-6 py-12 text-center space-y-4"
    >
      <div class="ylf-icon-tile mx-auto flex size-14 items-center justify-center rounded-2xl">
        <UIcon name="i-lucide-wallet" class="size-7" />
      </div>
      <p class="text-muted">
        登录后查看云币余额与充值记录
      </p>
      <UButton to="/login?redirect=/wallet" size="lg">
        去登录
      </UButton>
    </div>

    <template v-else>
      <!-- 余额 + 会员状态 -->
      <div class="grid gap-4 sm:grid-cols-2">
        <!-- 余额：渐变主卡 -->
        <div class="ylf-brand-bg relative overflow-hidden rounded-2xl p-6 text-white shadow-lg shadow-primary/20">
          <UIcon
            name="i-lucide-coins"
            class="pointer-events-none absolute -right-4 -bottom-4 size-32 opacity-15"
          />
          <p class="text-sm/relaxed text-white/80">
            云币余额
          </p>
          <div class="mt-2 flex items-end gap-2">
            <span class="text-5xl font-extrabold tabular-nums leading-none">{{ coin.balance.value }}</span>
            <span class="pb-1 text-white/80">云币</span>
          </div>
          <p class="mt-3 text-xs text-white/70">
            ≈ {{ formatPrice(coin.balance.value * COIN_RATE_FEN) }} · 100 云币 = 10 元
          </p>
        </div>

        <!-- 会员状态 -->
        <div
          class="flex flex-col justify-between rounded-2xl p-6"
          :class="coin.isMember.value ? 'ylf-member-soft' : 'ylf-surface'"
        >
          <div class="space-y-2">
            <p class="text-sm text-muted">
              云乐坊会员
            </p>
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="flex size-9 items-center justify-center rounded-xl"
                :class="coin.isMember.value ? 'ylf-member-mark' : 'bg-elevated text-muted'"
              >
                <UIcon name="i-lucide-cloud" class="size-5" />
              </span>
              <span class="text-lg font-semibold">
                {{ coin.isMember.value ? '会员有效' : '未开通' }}
              </span>
              <UBadge
                v-if="coin.isMember.value"
                :color="memberExpiringSoon ? 'warning' : 'primary'"
                variant="subtle"
                :icon="memberExpiringSoon ? 'i-lucide-clock-alert' : undefined"
              >
                {{ memberExpiringSoon ? `${memberDaysLeft} 天后到期` : `至 ${formatExpire(coin.membership.value?.expireAt ?? null)}` }}
              </UBadge>
            </div>
            <p v-if="memberExpiringSoon" class="text-xs text-warning">
              会员即将到期，续费以免权益中断
            </p>
          </div>
          <div class="pt-4">
            <UButton
              to="/pricing"
              size="sm"
              :variant="coin.isMember.value && !memberExpiringSoon ? 'outline' : 'solid'"
              :color="coin.isMember.value && !memberExpiringSoon ? 'neutral' : 'primary'"
              :trailing-icon="coin.isMember.value && !memberExpiringSoon ? undefined : 'i-lucide-arrow-right'"
            >
              {{ coin.isMember.value ? '续费会员' : '开通会员' }}
            </UButton>
          </div>
        </div>
      </div>

      <!-- 每日签到 -->
      <div class="ylf-surface flex flex-wrap items-center justify-between gap-3 rounded-2xl p-5">
        <div class="space-y-1">
          <p class="font-semibold">
            每日签到
          </p>
          <p class="text-sm text-muted">
            {{ coin.isMember.value ? '会员每日可领 2 云币' : '每日 1 云币，开通会员每日 2 云币' }}
          </p>
        </div>
        <SignInButton />
      </div>

      <!-- 充值 -->
      <section class="space-y-4">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-lg font-semibold">
            云币充值
          </h2>
          <YlfEyebrow label="💰 100 云币 = 10 元" />
        </div>

        <!-- 预设充值包 -->
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <button
            v-for="pack in packs"
            :key="pack.id"
            type="button"
            class="ylf-interactive-card relative rounded-2xl p-4 text-center"
            :class="pack.popular ? 'ring-2 ring-primary/50' : ''"
            @click="handleRecharge(pack.id)"
          >
            <UBadge
              v-if="pack.popular"
              label="🔥 推荐"
              color="primary"
              variant="solid"
              size="xs"
              class="absolute -top-2 left-1/2 -translate-x-1/2"
            />
            <div class="space-y-1 py-2">
              <UIcon name="i-lucide-coins" class="mx-auto size-7 text-primary" />
              <div class="text-2xl font-extrabold tabular-nums">
                {{ pack.coin }}
              </div>
              <div class="text-xs text-muted">
                云币
              </div>
              <div class="pt-1 font-semibold text-primary">
                {{ formatPrice(pack.amount) }}
              </div>
            </div>
          </button>
        </div>

        <!-- 自定义额度 -->
        <div class="ylf-soft-panel rounded-2xl p-4 sm:p-5 space-y-4">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-sliders-horizontal" class="size-4 text-primary" />
            <p class="text-sm font-medium text-highlighted">
              自定义充值额度
            </p>
          </div>

          <div class="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div class="flex-1 space-y-2">
              <UInput
                v-model.number="customCoin"
                type="number"
                :min="COIN_CUSTOM_MIN"
                :max="COIN_CUSTOM_MAX"
                placeholder="输入云币数量"
                size="lg"
                icon="i-lucide-coins"
                class="w-full"
                :ui="{ trailing: 'pe-3' }"
              >
                <template #trailing>
                  <span class="text-sm text-muted">云币</span>
                </template>
              </UInput>

              <div class="flex flex-wrap gap-2">
                <UButton
                  v-for="opt in quickAddOptions"
                  :key="opt"
                  size="xs"
                  variant="soft"
                  color="neutral"
                  @click="quickFill(opt)"
                >
                  +{{ opt }}
                </UButton>
              </div>

              <p v-if="customError" class="text-xs text-error">
                {{ customError }}
              </p>
              <p v-else class="text-xs text-muted">
                可充值 {{ COIN_CUSTOM_MIN }} ~ {{ COIN_CUSTOM_MAX.toLocaleString() }} 云币
              </p>
            </div>

            <div class="flex items-center justify-between gap-4 sm:flex-col sm:items-end sm:justify-start sm:text-right">
              <div>
                <div class="text-xs text-muted">
                  应付金额
                </div>
                <div class="text-2xl font-bold text-primary tabular-nums">
                  {{ formatPrice(customPrice) }}
                </div>
              </div>
              <UButton
                size="lg"
                :disabled="!customValid"
                trailing-icon="i-lucide-arrow-right"
                @click="handleCustomRecharge"
              >
                立即充值
              </UButton>
            </div>
          </div>
        </div>

        <p class="text-xs text-muted">
          云币为平台虚拟消费凭证，不可提现、不可转账。
        </p>
      </section>

      <!-- 流水 -->
      <section class="space-y-4">
        <h2 class="text-lg font-semibold">
          云币明细
        </h2>

        <div v-if="transactions.length === 0 && !txLoading" class="ylf-empty-state rounded-2xl py-12 text-center text-muted">
          <UIcon name="i-lucide-receipt-text" class="mx-auto mb-2 size-8 opacity-60" />
          <p>暂无记录</p>
        </div>

        <div v-else class="ylf-surface divide-y divide-default overflow-hidden rounded-2xl">
          <div
            v-for="tx in transactions"
            :key="tx._id"
            class="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-elevated/60"
          >
            <div class="flex min-w-0 items-center gap-3">
              <span
                class="flex size-9 shrink-0 items-center justify-center rounded-xl"
                :class="tx.amount >= 0 ? 'bg-success/12 text-success' : 'bg-elevated text-dimmed'"
              >
                <UIcon :name="tx.amount >= 0 ? 'i-lucide-arrow-down-left' : 'i-lucide-arrow-up-right'" class="size-4" />
              </span>
              <div class="min-w-0 space-y-0.5">
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
            </div>
            <div class="text-right">
              <div
                class="font-semibold tabular-nums"
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

      <!-- 订单历史 -->
      <section class="space-y-4">
        <h2 class="text-lg font-semibold">
          订单历史
        </h2>

        <div v-if="orders.length === 0 && !orderLoading" class="ylf-empty-state rounded-2xl py-12 text-center text-muted">
          <UIcon name="i-lucide-scroll-text" class="mx-auto mb-2 size-8 opacity-60" />
          <p>暂无订单</p>
        </div>

        <div v-else class="ylf-surface divide-y divide-default overflow-hidden rounded-2xl">
          <div
            v-for="order in orders"
            :key="order.id"
            class="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-elevated/60"
          >
            <div class="flex min-w-0 items-center gap-3">
              <span
                class="flex size-9 shrink-0 items-center justify-center rounded-xl"
                :class="order.orderType === 'membership' ? 'ylf-member-mark' : 'bg-elevated text-dimmed'"
              >
                <UIcon :name="order.orderType === 'membership' ? 'i-lucide-crown' : 'i-lucide-coins'" class="size-4" />
              </span>
              <div class="min-w-0 space-y-0.5">
                <div class="flex items-center gap-2">
                  <span class="truncate font-medium">{{ orderTitle(order) }}</span>
                  <UBadge :color="orderStatusMeta(order.status).color" variant="subtle" size="sm" class="shrink-0">
                    {{ orderStatusMeta(order.status).label }}
                  </UBadge>
                </div>
                <div class="text-xs text-muted">
                  {{ formatDate(order.createdAt) }}
                </div>
              </div>
            </div>
            <div class="shrink-0 text-right font-semibold tabular-nums">
              {{ formatPrice(order.amount) }}
            </div>
          </div>
        </div>

        <div v-if="orderHasMore" class="text-center">
          <UButton
            variant="outline"
            color="neutral"
            size="sm"
            :loading="orderLoading"
            @click="loadOrders()"
          >
            加载更多
          </UButton>
        </div>
      </section>

      <!-- 应用支持榜 -->
      <AppTipLeaderboard :limit="10" />
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

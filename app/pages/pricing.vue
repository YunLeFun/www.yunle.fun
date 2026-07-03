<script setup lang="ts">
import type { BillingCycle, PlanId } from '~/types/payment'
import pricingPage from '~~/content/2.pricing.yml'

const page = ref(pricingPage)

interface PricingFaqItem {
  label: string
  content: string
  to?: string
}

const title = page.value?.seo?.title || page.value?.title
const description = page.value?.seo?.description || page.value?.description
const faqItems = computed(() => (page.value?.faq.items ?? []) as PricingFaqItem[])
const PENDING_ORDER_KEY = 'wxpay:pending-order'

interface PricingMembershipView {
  isMember: boolean
  name: string
  expire: string
}

interface PricingPurchaseRequest {
  key: number
  planId?: PlanId
  cycle?: BillingCycle
}

useSeoMeta({
  title,
  ogTitle: title,
  description,
  ogDescription: description,
})

const membershipView = reactive<PricingMembershipView>({
  isMember: false,
  name: '晴空会员',
  expire: '—— / ——',
})
const shouldProbeMembership = ref(false)
const purchaseRequest = ref<PricingPurchaseRequest | null>(null)

const isMember = computed(() => membershipView.isMember)
const memberName = computed(() => membershipView.name)
const memberExpire = computed(() => membershipView.expire)

// 会员专属权益（6 项，与设计稿一致；多彩图标点缀）
const BENEFITS = [
  { icon: 'i-lucide-refresh-cw', title: '用户数据同步', desc: '设置、偏好与进度跨设备实时同步', color: 'var(--ylf-dopa-cyan)' },
  { icon: 'i-lucide-bookmark', title: '收藏 / 历史记录', desc: '无限收藏，完整保留浏览与使用历史', color: 'var(--ylf-dopa-violet)' },
  { icon: 'i-lucide-layers', title: '跨应用共享', desc: '一处开通，所有云乐坊小应用通用', color: 'var(--ylf-dopa-blue)', highlight: true },
  { icon: 'i-lucide-infinity', title: '部分功能免扣云币', desc: '会员期内指定功能直接免费，不耗云币', color: 'var(--ylf-dopa-green)', free: true },
  { icon: 'i-lucide-shield-off', title: '去广告 · 高级功能', desc: '移除广告，解锁全部高级能力', color: 'var(--ylf-dopa-amber)' },
  { icon: 'i-lucide-headphones', title: '专属客服 · 优先支持', desc: '问题优先响应，专属客服通道', color: 'var(--ylf-dopa-pink)' },
]

/**
 * 构建月付和年付两个套餐选项
 */
const billingPlans = computed(() => {
  if (!page.value?.plans)
    return []
  const plan = page.value.plans[0] // 只有一个基础版
  if (!plan)
    return []

  const basePlan = {
    ...plan,
    planId: plan.planId,
    features: plan.features,
  }

  return [
    {
      ...basePlan,
      title: '月付会员',
      cycle: 'month' as BillingCycle,
      price: plan.price.month,
      billingCycle: '/月',
      sub: '随时可取消',
      label: '立即订阅',
    },
    {
      ...basePlan,
      title: '年付会员',
      cycle: 'year' as BillingCycle,
      price: plan.price.year,
      billingCycle: '/年',
      sub: '省 ¥20 · 立减两个月',
      label: '立即订阅',
      highlight: true,
    },
  ]
})

/**
 * 点击套餐按钮
 */
function handlePurchase(planId: PlanId, cycle: BillingCycle) {
  purchaseRequest.value = { key: Date.now(), planId, cycle }
}

function handlePurchaseClose() {
  purchaseRequest.value = null
}

function handleMembershipUpdate(view: PricingMembershipView) {
  Object.assign(membershipView, view)
}

function hasPendingMembershipOrder() {
  if (import.meta.server || typeof sessionStorage === 'undefined')
    return false
  try {
    return Boolean(sessionStorage.getItem(PENDING_ORDER_KEY))
  }
  catch {
    return false
  }
}

// 公开首屏保持静态；登录态/支付状态在客户端按需加载。
onMounted(() => {
  if (hasPendingMembershipOrder())
    purchaseRequest.value = { key: Date.now() }

  window.setTimeout(() => {
    shouldProbeMembership.value = true
  }, 1200)
})
</script>

<template>
  <div v-if="page" class="ylf-pricing pb-16">
    <UContainer class="space-y-12 py-8 sm:py-10">
      <!-- 晴空 hero -->
      <SkyHero>
        <div class="grid items-center gap-8 p-6 sm:p-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div class="text-white">
            <span class="ylf-glass ylf-hero-shadow inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold">
              <UIcon name="i-lucide-sparkles" class="size-3.5 text-amber-200" />
              云乐坊会员 · 晴空同行
            </span>
            <h1 class="ylf-dreamy-display ylf-hero-shadow mt-5 text-4xl leading-[1.15] sm:text-5xl">
              {{ isMember ? '你的晴空，一直都在' : '推开云层，遇见晴空' }}
            </h1>
            <p class="ylf-hero-shadow mt-4 max-w-md text-sm/relaxed text-white/90 sm:text-base/relaxed">
              {{ isMember
                ? '会员权益在所有云乐坊小应用中持续生效，部分功能免扣云币 —— 晴朗一直在线。'
                : '开通会员，点亮所有云乐坊小应用的晴朗体验：跨应用通用、数据同步、免扣云币。' }}
            </p>
            <div class="ylf-hero-shadow mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-white/85 sm:text-sm">
              <span class="inline-flex items-center gap-1.5"><UIcon name="i-lucide-layers" class="size-4" />跨应用通用</span>
              <span class="inline-flex items-center gap-1.5"><UIcon name="i-lucide-refresh-cw" class="size-4" />数据同步</span>
              <span class="inline-flex items-center gap-1.5"><UIcon name="i-lucide-infinity" class="size-4" />免扣云币</span>
            </div>
          </div>
          <div class="mx-auto w-full max-w-sm">
            <MemberPass :member="isMember" :name="memberName" :expire="memberExpire" />
          </div>
        </div>
      </SkyHero>

      <!-- 方案选择 -->
      <section class="space-y-6">
        <div class="text-center">
          <h2 class="ylf-dreamy-display text-2xl text-highlighted sm:text-3xl">
            选择你的方案
          </h2>
          <p class="mt-2 text-sm text-muted">
            单一会员等级，月付或年付随心选 · 7 天无理由退款
          </p>
        </div>
        <div class="mx-auto grid max-w-3xl gap-5 sm:grid-cols-2">
          <div
            v-for="(plan, index) in billingPlans"
            :key="index"
            class="ylf-plan relative flex flex-col rounded-3xl p-6"
            :class="plan.highlight ? 'ylf-plan--best' : ''"
          >
            <span
              v-if="plan.highlight"
              class="ylf-member-mark absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-semibold"
            >
              省 ¥20 · 最划算
            </span>
            <div class="text-sm font-semibold text-muted">
              {{ plan.title }}
            </div>
            <div class="mt-2 flex items-end gap-1">
              <span class="ylf-dreamy-display text-4xl text-highlighted">{{ plan.price }}</span>
              <span class="pb-1.5 text-sm text-muted">{{ plan.billingCycle }}</span>
            </div>
            <p class="mt-1 text-xs text-primary">
              {{ plan.sub }}
            </p>
            <ul class="mt-5 flex-1 space-y-2.5 text-sm">
              <li v-for="f in plan.features" :key="f" class="flex items-center gap-2 text-toned">
                <UIcon name="i-lucide-check" class="size-4 shrink-0 text-primary" />
                {{ f }}
              </li>
              <li class="flex items-center gap-2 text-toned">
                <UIcon name="i-lucide-check" class="size-4 shrink-0 text-primary" />
                跨应用通用 · 免扣云币
              </li>
            </ul>
            <UButton
              :label="plan.label"
              block
              size="lg"
              :class="plan.highlight ? 'ylf-brand-btn mt-6' : 'mt-6'"
              :color="plan.highlight ? 'primary' : 'neutral'"
              :variant="plan.highlight ? 'solid' : 'outline'"
              @click="handlePurchase(plan.planId as PlanId, plan.cycle)"
            />
          </div>
        </div>
      </section>

      <!-- 专属权益 -->
      <section class="space-y-6">
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 class="ylf-dreamy-display text-2xl text-highlighted sm:text-3xl">
            专属权益
          </h2>
          <span class="text-sm text-muted">会员点亮的 6 项晴朗体验</span>
        </div>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="b in BENEFITS"
            :key="b.title"
            class="ylf-benefit relative overflow-hidden rounded-3xl p-5"
          >
            <span
              class="ylf-dopa-tile mb-3.5 inline-flex size-12 items-center justify-center rounded-2xl"
              :style="{ '--tile': b.color }"
            >
              <UIcon :name="b.icon" class="size-6" />
            </span>
            <div class="flex items-center gap-2">
              <h3 class="font-bold text-highlighted">
                {{ b.title }}
              </h3>
              <span v-if="b.free" class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-400/15 dark:text-amber-300">免扣</span>
              <span v-else-if="b.highlight" class="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">核心</span>
            </div>
            <p class="mt-1.5 text-sm/relaxed text-muted">
              {{ b.desc }}
            </p>
          </div>
        </div>
      </section>

      <!-- 云币 与 会员 -->
      <section class="ylf-coin-strip flex flex-col items-start gap-5 rounded-3xl p-6 sm:flex-row sm:items-center">
        <div class="flex flex-1 items-center gap-3 sm:gap-4">
          <span class="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300">
            <UIcon name="i-lucide-coins" class="size-6" />
          </span>
          <UIcon name="i-lucide-plus" class="size-5 shrink-0 text-dimmed" />
          <span class="ylf-member-mark inline-flex size-12 shrink-0 items-center justify-center rounded-2xl">
            <UIcon name="i-lucide-cloud" class="size-6" />
          </span>
          <div class="min-w-0">
            <div class="font-bold text-highlighted">
              云币 与 会员 · 各自独立，晴朗叠加
            </div>
            <p class="mt-1 text-sm/relaxed text-muted">
              云币按次消费，会员按时间授权，两者互不影响。<b class="text-primary">会员期内</b>指定功能直接免扣云币。
            </p>
          </div>
        </div>
        <UButton
          to="/wallet"
          label="查看钱包"
          color="primary"
          variant="soft"
          trailing-icon="i-lucide-arrow-right"
          class="shrink-0"
        />
      </section>

      <!-- FAQ -->
      <section class="space-y-6">
        <div class="text-center">
          <h2 class="ylf-dreamy-display text-2xl text-highlighted sm:text-3xl">
            {{ page.faq.title }}
          </h2>
          <p class="mt-2 text-sm text-muted">
            {{ page.faq.description }}
          </p>
        </div>
        <UAccordion
          :items="faqItems"
          :unmount-on-hide="false"
          :default-value="['0']"
          type="multiple"
          class="mx-auto max-w-3xl"
          :ui="{
            item: 'ylf-soft-panel mb-3 rounded-2xl border-0 px-4',
            trigger: 'text-base text-highlighted py-4',
            body: 'text-sm text-muted pb-4',
          }"
        >
          <template #body="{ item }">
            <p>{{ item.content }}</p>
            <UButton
              v-if="item.to"
              :to="item.to"
              variant="link"
              color="primary"
              trailing-icon="i-lucide-arrow-right"
              class="mt-2 p-0"
            >
              查看联系渠道
            </UButton>
          </template>
        </UAccordion>
      </section>
    </UContainer>

    <ClientOnly>
      <LazyPricingMembershipProbe
        v-if="shouldProbeMembership"
        @update="handleMembershipUpdate"
      />
      <LazyPricingPaymentController
        v-if="purchaseRequest"
        :key="purchaseRequest.key"
        :plan-id="purchaseRequest.planId"
        :cycle="purchaseRequest.cycle"
        @close="handlePurchaseClose"
      />
    </ClientOnly>
  </div>
</template>

<style scoped>
.ylf-hero-shadow {
  text-shadow: 0 1px 10px rgba(0, 40, 90, 0.35);
}

/* 方案卡 */
.ylf-plan {
  background: var(--ylf-surface);
  border: 1px solid var(--ui-border-muted);
  box-shadow: 0 18px 40px -28px color-mix(in srgb, #0b82c4 50%, transparent);
}

.ylf-plan--best {
  border-color: color-mix(in srgb, var(--ui-primary) 45%, transparent);
  box-shadow: 0 22px 48px -26px color-mix(in srgb, #0b82c4 60%, transparent);
}

/* 权益卡 */
.ylf-benefit {
  background: var(--ylf-surface);
  border: 1px solid var(--ui-border-muted);
  box-shadow: 0 16px 36px -30px color-mix(in srgb, #386ebe 80%, transparent);
  transition:
    transform 200ms var(--ease-out, ease),
    box-shadow 200ms ease;
}

.ylf-benefit:hover {
  transform: translateY(-3px);
  box-shadow: 0 22px 44px -26px color-mix(in srgb, #0b82c4 55%, transparent);
}

/* 云币 vs 会员说明条 */
.ylf-coin-strip {
  background: linear-gradient(120deg, #e6f2ff, #fff7ec);
  border: 1px solid color-mix(in srgb, #7dd3fc 60%, transparent);
}

.dark .ylf-coin-strip {
  background: color-mix(in srgb, var(--ylf-surface) 80%, transparent);
  border-color: color-mix(in srgb, #38bdf8 24%, transparent);
}
</style>

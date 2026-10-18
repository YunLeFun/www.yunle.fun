<script setup lang="ts">
import type { BillingCycle, PlanId } from '~/types/payment'
import pricingPage from '~~/content/2.pricing.yml'
import { vReveal } from '~/composables/useReveal'
import { PLAN_PRICES } from '~/types/payment'

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
  expireAt: number | null
  cycle: BillingCycle
  serial: string
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
  expireAt: null,
  cycle: 'month',
  serial: '',
})
const shouldProbeMembership = ref(false)
const purchaseRequest = ref<PricingPurchaseRequest | null>(null)

const isMember = computed(() => membershipView.isMember)
const memberName = computed(() => membershipView.name)
const memberExpire = computed(() => membershipView.expire)
const memberDaysLeft = computed(() => {
  if (!membershipView.expireAt)
    return null
  return Math.max(0, Math.ceil((membershipView.expireAt - Date.now()) / 86_400_000))
})

// 会员专属权益（6 项，与设计稿一致；多彩图标点缀）
const BENEFITS = [
  { icon: 'i-lucide-refresh-cw', title: '用户数据同步', desc: '设置、偏好与进度跨设备实时同步', color: 'var(--ylf-dopa-cyan)' },
  { icon: 'i-lucide-bookmark', title: '收藏 / 历史记录', desc: '无限收藏，完整保留浏览与使用历史', color: 'var(--ylf-dopa-violet)' },
  { icon: 'i-lucide-layers', title: '跨应用共享', desc: '一处开通，所有云乐坊小应用通用', color: 'var(--ylf-dopa-blue)', highlight: true },
  { icon: 'i-lucide-infinity', title: '部分功能免扣云币', desc: '会员期内指定功能直接免费，不耗云币', color: 'var(--ylf-dopa-green)', free: true },
  { icon: 'i-lucide-shield-off', title: '去广告 · 高级功能', desc: '移除广告，解锁全部高级能力', color: 'var(--ylf-dopa-amber)' },
  { icon: 'i-lucide-headphones', title: '专属客服 · 优先支持', desc: '问题优先响应，专属客服通道', color: 'var(--ylf-dopa-pink)' },
]

const MONTH_FEN = PLAN_PRICES.basic.month
const YEAR_FEN = PLAN_PRICES.basic.year
/** 年付相对按月买 12 次省下的金额（元） */
const yearSaving = Math.round((MONTH_FEN * 12 - YEAR_FEN) / 100)

function yuan(fen: number, digits = 2) {
  return `¥${Number((fen / 100).toFixed(digits))}`
}

/** 续费从当前到期时间顺延；这里只做展示用的粗略推算（精确到月） */
function extendedExpire(cycle: BillingCycle) {
  if (!membershipView.expireAt)
    return ''
  const d = new Date(membershipView.expireAt)
  if (cycle === 'year')
    d.setFullYear(d.getFullYear() + 1)
  else
    d.setMonth(d.getMonth() + 1)
  return `${d.getFullYear()} / ${String(d.getMonth() + 1).padStart(2, '0')}`
}

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
      tagline: '先飞一个月，看看晴空',
      icon: 'i-lucide-cloud-sun',
      cycle: 'month' as BillingCycle,
      price: plan.price.month,
      billingCycle: '/月',
      perDay: `约 ${yuan(MONTH_FEN / 30)} / 天`,
      original: '',
      sub: '按自然月生效 · 单次购买',
      label: '立即购买',
    },
    {
      ...basePlan,
      title: '年付会员',
      tagline: '一整年，天天都是晴天',
      icon: 'i-lucide-sun',
      cycle: 'year' as BillingCycle,
      price: plan.price.year,
      billingCycle: '/年',
      perDay: `折合 ${yuan(YEAR_FEN / 12, 1)} / 月`,
      original: yuan(MONTH_FEN * 12, 0),
      sub: '按自然年生效 · 单次购买',
      label: '立即购买',
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

function scrollToSection(id: string) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  document.getElementById(id)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
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
    <AppContainer class="space-y-14 py-8 sm:py-10">
      <!-- 晴空 hero -->
      <SkyHero>
        <div class="grid items-center gap-8 p-6 sm:p-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div class="text-white">
            <span class="ylf-glass ylf-hero-shadow inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold">
              <Icon name="i-lucide-sparkles" class="size-3.5 text-amber-200" />
              云乐坊会员 · 晴空同行
            </span>
            <h1 class="ylf-display ylf-hero-shadow mt-5">
              {{ isMember ? '你的晴空，一直都在' : '推开云层，遇见晴空' }}
            </h1>
            <p class="ylf-hero-shadow mt-4 max-w-md text-sm/relaxed text-white/90 sm:text-base/relaxed">
              {{ isMember
                ? '会员权益在所有云乐坊小应用中持续生效，部分功能免扣云币 —— 晴朗一直在线。'
                : '开通会员，点亮所有云乐坊小应用的晴朗体验：跨应用通用、数据同步、免扣云币。' }}
            </p>

            <div v-if="isMember" class="mt-5 flex flex-wrap items-center gap-2">
              <MemberBadge variant="frost" size="md" label="会员有效" />
              <span v-if="memberDaysLeft !== null" class="ylf-glass ylf-hero-shadow inline-flex h-7 items-center gap-1 rounded-full px-3 text-sm font-semibold">
                <Icon name="i-lucide-sun" class="size-4 text-amber-200" />
                还有 {{ memberDaysLeft }} 天晴空
              </span>
            </div>
            <div v-else class="ylf-hero-shadow mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-white/85 sm:text-sm">
              <span class="inline-flex items-center gap-1.5"><Icon name="i-lucide-layers" class="size-4" />跨应用通用</span>
              <span class="inline-flex items-center gap-1.5"><Icon name="i-lucide-refresh-cw" class="size-4" />数据同步</span>
              <span class="inline-flex items-center gap-1.5"><Icon name="i-lucide-infinity" class="size-4" />免扣云币</span>
            </div>

            <div class="mt-7 flex flex-wrap gap-3">
              <AppButton
                :label="isMember ? '续费会员' : '选择方案'"
                :icon="isMember ? 'i-lucide-refresh-ccw' : 'i-lucide-arrow-down'"
                size="lg"
                variant="hero"
                class="rounded-[var(--ylf-radius)] font-semibold"
                @click="scrollToSection('plans')"
              />
              <AppButton
                v-if="isMember"
                to="/wallet"
                label="查看钱包"
                icon="i-lucide-wallet"
                size="lg"
                color="neutral"
                variant="outline"
                class="ylf-glass-btn rounded-[var(--ylf-radius)]"
              />
              <AppButton
                v-else
                label="看看权益"
                icon="i-lucide-gift"
                size="lg"
                color="neutral"
                variant="outline"
                class="ylf-glass-btn rounded-[var(--ylf-radius)]"
                @click="scrollToSection('benefits')"
              />
            </div>
          </div>
          <div class="mx-auto w-full max-w-sm">
            <MemberPass
              :member="isMember"
              :name="memberName"
              :expire="memberExpire"
              :expire-at="membershipView.expireAt"
              :cycle="membershipView.cycle"
              :serial="membershipView.serial"
              @unlock="scrollToSection('plans')"
            />
          </div>
        </div>
      </SkyHero>

      <!-- 方案选择 -->
      <section id="plans" class="ylf-pricing-anchor space-y-7">
        <div class="text-center">
          <h2 class="ylf-headline text-highlighted">
            {{ isMember ? '续上你的晴空' : '选择你的方案' }}
          </h2>
          <p class="mt-2 text-sm text-muted">
            {{ isMember
              ? '续费从当前到期日顺延，权益不中断 · 单次购买，不会自动扣款'
              : '单一会员等级，月付或年付随心选 · 7 天无理由退款' }}
          </p>
        </div>
        <div class="mx-auto grid max-w-3xl gap-5 sm:grid-cols-2">
          <article
            v-for="(plan, index) in billingPlans"
            :key="index"
            class="ylf-plan ylf-press relative flex flex-col"
            :class="{ 'ylf-plan--best': plan.highlight }"
          >
            <!-- 晴空小窗：月付是清晨薄云，年付是正午晴空 -->
            <div class="ylf-plan__sky" :class="plan.highlight ? 'ylf-plan__sky--noon' : 'ylf-plan__sky--dawn'" aria-hidden="true">
              <span v-if="plan.highlight" class="ylf-plan__sun" />
              <CuteCloud shape="long" class="ylf-plan__cloud ylf-plan__cloud--a" />
              <CuteCloud :shape="plan.highlight ? 'round' : 'small'" :face="plan.highlight" class="ylf-plan__cloud ylf-plan__cloud--b" />
            </div>

            <span
              v-if="plan.highlight"
              class="ylf-member-frost absolute top-3 right-3 z-[2] inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold"
            >
              <Icon name="i-lucide-sparkles" class="size-3.5" />
              省 ¥{{ yearSaving }} · 最划算
            </span>

            <div class="relative z-[1] -mt-7 flex flex-1 flex-col px-6 pb-6">
              <span
                class="ylf-plan__icon inline-flex size-12 items-center justify-center rounded-2xl"
                :class="plan.highlight ? 'ylf-gradient-tile' : 'ylf-icon-tile'"
              >
                <Icon :name="plan.icon" class="size-6" />
              </span>
              <h3 class="mt-3 font-bold text-highlighted">
                {{ plan.title }}
              </h3>
              <p class="mt-0.5 text-xs text-muted">
                {{ plan.tagline }}
              </p>

              <div class="mt-4 flex items-end gap-1.5">
                <span class="ylf-dreamy-display text-[2.75rem] leading-none text-highlighted">{{ plan.price }}</span>
                <span class="pb-1 text-sm text-muted">{{ plan.billingCycle }}</span>
                <s v-if="plan.original" class="pb-1 text-xs text-dimmed">{{ plan.original }}</s>
              </div>
              <p class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span class="ylf-plan__chip rounded-full px-2 py-0.5 font-semibold">{{ plan.perDay }}</span>
                <span class="text-muted">{{ plan.sub }}</span>
              </p>

              <ul class="mt-5 flex-1 space-y-2.5 text-sm">
                <li v-for="f in plan.features" :key="f" class="flex items-center gap-2 text-toned">
                  <span class="ylf-plan__check inline-flex size-5 shrink-0 items-center justify-center rounded-full">
                    <Icon name="i-lucide-check" class="size-3.5" />
                  </span>
                  {{ f }}
                </li>
                <li class="flex items-center gap-2 text-toned">
                  <span class="ylf-plan__check inline-flex size-5 shrink-0 items-center justify-center rounded-full">
                    <Icon name="i-lucide-check" class="size-3.5" />
                  </span>
                  跨应用通用 · 免扣云币
                </li>
              </ul>

              <p v-if="isMember && extendedExpire(plan.cycle)" class="ylf-plan__extend mt-5 flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs">
                <Icon name="i-lucide-calendar-plus" class="size-4 shrink-0" />
                续费后顺延至 <b class="tabular-nums">{{ extendedExpire(plan.cycle) }}</b>
              </p>

              <AppButton
                :label="isMember ? `续费${plan.title.slice(0, 2)} · ${plan.label}` : plan.label"
                block
                size="lg"
                :class="plan.highlight ? 'ylf-brand-btn mt-5' : 'mt-5'"
                :color="plan.highlight ? 'primary' : 'neutral'"
                :variant="plan.highlight ? 'solid' : 'outline'"
                @click="handlePurchase(plan.planId as PlanId, plan.cycle)"
              />
            </div>
          </article>
        </div>
        <p class="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted">
          <span class="inline-flex items-center gap-1"><Icon name="i-lucide-shield-check" class="size-3.5 text-success" />微信安全支付</span>
          <span class="inline-flex items-center gap-1"><Icon name="i-lucide-ban" class="size-3.5 text-primary" />不自动续费</span>
          <span class="inline-flex items-center gap-1"><Icon name="i-lucide-undo-2" class="size-3.5 text-primary" />7 天无理由退款</span>
        </p>
      </section>

      <!-- 专属权益 -->
      <section id="benefits" class="ylf-pricing-anchor space-y-6">
        <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 class="ylf-headline text-highlighted">
              专属权益
            </h2>
            <span class="text-sm text-muted">{{ isMember ? '这些晴朗已经为你点亮' : '开通后一次点亮 6 项晴朗体验' }}</span>
          </div>
          <span v-if="isMember" class="ylf-benefit-count inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold">
            <Icon name="i-lucide-sun" class="size-3.5" />
            已点亮 {{ BENEFITS.length }} / {{ BENEFITS.length }}
          </span>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          <div v-for="(b, i) in BENEFITS" :key="b.title" v-reveal="i * 60">
            <div
              class="ylf-benefit relative flex h-full items-start gap-4 overflow-hidden rounded-[var(--ylf-radius-lg)] p-4 sm:block sm:p-5"
              :class="{ 'is-lit': isMember }"
              :style="{ '--tile': b.color }"
            >
              <Icon :name="b.icon" class="ylf-benefit__mark pointer-events-none absolute -right-5 -bottom-5 size-28" aria-hidden="true" />
              <span v-if="isMember" class="ylf-benefit__lit absolute top-4 right-4 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold sm:top-5 sm:right-5">
                <Icon name="i-lucide-check" class="size-3" />
                已点亮
              </span>
              <span class="ylf-dopa-tile ylf-benefit__tile relative inline-flex size-11 shrink-0 items-center justify-center rounded-2xl sm:size-12">
                <Icon :name="b.icon" class="size-6" />
              </span>
              <div class="relative min-w-0 sm:mt-3.5" :class="{ 'pe-16 sm:pe-0': isMember }">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="font-bold text-highlighted">
                    {{ b.title }}
                  </h3>
                  <span v-if="b.free" class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-400/15 dark:text-amber-300">免扣</span>
                  <span v-else-if="b.highlight" class="rounded-full bg-primary/5 px-2 py-0.5 text-[10px] font-bold text-primary dark:bg-primary/15">核心</span>
                </div>
                <p class="mt-1 text-sm/relaxed text-muted sm:mt-1.5">
                  {{ b.desc }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 云币 与 会员 -->
      <section class="ylf-coin-strip relative overflow-hidden rounded-[var(--ylf-radius-xl)] p-5 sm:p-7">
        <CuteCloud shape="long" class="pointer-events-none absolute opacity-70" style="width: 14rem; top: -1rem; right: -2.5rem" />
        <div class="relative flex flex-col gap-6 lg:flex-row lg:items-center">
          <div class="lg:w-64 lg:shrink-0">
            <h2 class="ylf-section-title">
              云币 与 会员
            </h2>
            <p class="mt-1 text-sm/relaxed text-muted">
              各自独立，晴朗叠加。<b class="text-primary">会员期内</b>指定功能直接免扣云币。
            </p>
            <AppButton
              to="/wallet"
              label="查看钱包"
              color="primary"
              variant="soft"
              size="sm"
              trailing-icon="i-lucide-arrow-right"
              class="mt-4"
            />
          </div>
          <div class="grid flex-1 items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <div class="ylf-coin-card flex items-start gap-3 rounded-2xl p-4">
              <span class="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300">
                <Icon name="i-lucide-coins" class="size-6" />
              </span>
              <div class="min-w-0">
                <div class="font-bold text-highlighted">
                  云币 · 按次消费
                </div>
                <p class="mt-0.5 text-xs/relaxed text-muted">
                  用多少扣多少，充值后长期有效，适合偶尔用用。
                </p>
              </div>
            </div>
            <span class="ylf-coin-plus mx-auto inline-flex size-9 shrink-0 items-center justify-center self-center rounded-full">
              <Icon name="i-lucide-plus" class="size-4" />
            </span>
            <div class="ylf-coin-card flex items-start gap-3 rounded-2xl p-4">
              <span class="ylf-member-mark inline-flex size-11 shrink-0 items-center justify-center rounded-2xl">
                <Icon name="i-lucide-cloud" class="size-6" />
              </span>
              <div class="min-w-0">
                <div class="font-bold text-highlighted">
                  会员 · 按时间授权
                </div>
                <p class="mt-0.5 text-xs/relaxed text-muted">
                  有效期内权益全开，常用功能不再扣云币。
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- FAQ -->
      <section class="space-y-6">
        <div class="text-center">
          <h2 class="ylf-headline text-highlighted">
            {{ page.faq.title }}
          </h2>
          <p class="mt-2 text-sm text-muted">
            {{ page.faq.description }}
          </p>
        </div>
        <AppAccordion
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
            <AppButton
              v-if="item.to"
              :to="item.to"
              variant="link"
              color="primary"
              trailing-icon="i-lucide-arrow-right"
              class="mt-2 p-0"
            >
              查看联系渠道
            </AppButton>
          </template>
        </AppAccordion>
      </section>
    </AppContainer>

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

/* 锚点跳转时给顶部导航留出空间 */
.ylf-pricing-anchor {
  scroll-margin-top: 5.5rem;
}

/* ---------------- 方案卡 ---------------- */
.ylf-plan {
  overflow: hidden;
  border-radius: var(--ylf-radius-xl);
  background: var(--ylf-surface);
  border: 1px solid var(--ui-border-muted);
  box-shadow: 0 18px 40px -28px color-mix(in srgb, #0b82c4 50%, transparent);
  transition:
    translate 360ms var(--ylf-ease-spring),
    box-shadow 240ms ease,
    scale var(--ylf-duration-slow) var(--ylf-ease-spring);
}

.ylf-plan:hover {
  translate: 0 -4px;
  box-shadow: 0 28px 52px -28px color-mix(in srgb, #0b82c4 60%, transparent);
}

/* 推荐方案：品牌渐变描边 */
.ylf-plan--best {
  border: 1.5px solid transparent;
  background:
    linear-gradient(var(--ylf-surface), var(--ylf-surface)) padding-box,
    var(--ylf-gradient-brand) border-box;
  box-shadow: 0 26px 54px -26px color-mix(in srgb, #0b82c4 62%, transparent);
}

.ylf-plan__sky {
  position: relative;
  height: 6.5rem;
  overflow: hidden;
}

.ylf-plan__sky--dawn {
  background: linear-gradient(
    180deg,
    #cfe6ff 0%,
    #f3e8ff 70%,
    color-mix(in srgb, #ffe4e6 70%, var(--ylf-surface)) 100%
  );
}

.ylf-plan__sky--noon {
  background: linear-gradient(180deg, #3b9cf0 0%, #6ec3f7 55%, #bfe6ff 100%);
}

.dark .ylf-plan__sky--dawn {
  background: linear-gradient(180deg, #27325f 0%, #4b3a74 70%, #5b3b66 100%);
}

.dark .ylf-plan__sky--noon {
  background: linear-gradient(180deg, #1e3a8a 0%, #4f46e5 60%, #c26a9a 100%);
}

/* 底部淡出到卡面，图标贴片压在交界处 */
.ylf-plan__sky::after {
  position: absolute;
  inset: auto 0 0;
  height: 40%;
  background: linear-gradient(180deg, transparent, var(--ylf-surface));
  content: '';
}

.ylf-plan__sun {
  position: absolute;
  top: 0.9rem;
  left: 44%;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 999px;
  background: radial-gradient(circle, #fff7d1 0%, #ffd23f 60%, #fbbf24 100%);
  box-shadow:
    0 0 0 10px rgba(255, 221, 120, 0.22),
    0 0 40px 10px rgba(255, 210, 63, 0.45);
  transition: translate 600ms var(--ylf-ease-spring);
}

.ylf-plan__cloud {
  position: absolute;
  transition: translate 900ms var(--ylf-ease-spring);
}

.ylf-plan__cloud--a {
  top: 1.4rem;
  right: -1.5rem;
  width: 9.5rem;
  opacity: 0.95;
}

.ylf-plan__cloud--b {
  top: 0.5rem;
  left: 28%;
  width: 4.5rem;
  opacity: 0.85;
}

.ylf-plan--best .ylf-plan__cloud--b {
  top: 1.5rem;
  left: auto;
  right: 34%;
  width: 4.75rem;
  opacity: 1;
}

/* 悬停时云朵各自飘开一点、太阳升起来 */
.ylf-plan:hover .ylf-plan__cloud--a {
  translate: 10px 0;
}

.ylf-plan:hover .ylf-plan__cloud--b {
  translate: -8px -2px;
}

.ylf-plan:hover .ylf-plan__sun {
  translate: 0 -4px;
}

.ylf-plan__icon {
  box-shadow: 0 10px 24px -14px color-mix(in srgb, #0b82c4 70%, transparent);
}

.ylf-plan__icon.ylf-icon-tile {
  background: var(--ylf-surface);
}

.ylf-plan__chip {
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 10%, var(--ylf-surface));
}

.ylf-plan--best .ylf-plan__chip {
  color: #fff;
  background: var(--ylf-gradient-brand);
}

.ylf-plan__check {
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 12%, var(--ylf-surface));
}

.ylf-plan__extend {
  color: var(--ui-text-toned);
  background: color-mix(in srgb, var(--ylf-dopa-amber) 12%, var(--ylf-surface));
  border: 1px dashed color-mix(in srgb, var(--ylf-dopa-amber) 45%, transparent);
}

.ylf-plan__extend > :first-child {
  color: var(--ylf-dopa-amber);
}

/* ---------------- 权益卡 ---------------- */
.ylf-benefit {
  background: var(--ylf-surface);
  border: 1px solid var(--ui-border-muted);
  box-shadow: 0 16px 36px -30px color-mix(in srgb, #386ebe 80%, transparent);
  transition:
    translate 320ms var(--ylf-ease-spring),
    box-shadow 220ms ease,
    border-color 220ms ease;
}

/* 左上角一团随强调色的柔光，悬停时亮起 */
.ylf-benefit::before {
  position: absolute;
  inset: 0;
  background: radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, var(--tile) 16%, transparent), transparent 60%);
  content: '';
  opacity: 0;
  pointer-events: none;
  transition: opacity 260ms ease;
}

.ylf-benefit:hover {
  translate: 0 -3px;
  border-color: color-mix(in srgb, var(--tile) 32%, var(--ui-border-muted));
  box-shadow: 0 22px 44px -26px color-mix(in srgb, var(--tile) 50%, transparent);
}

.ylf-benefit:hover::before,
.ylf-benefit.is-lit::before {
  opacity: 1;
}

.ylf-benefit__mark {
  color: var(--tile);
  opacity: 0.06;
  rotate: -12deg;
  transition:
    opacity 260ms ease,
    rotate 520ms var(--ylf-ease-spring);
}

.ylf-benefit:hover .ylf-benefit__mark {
  opacity: 0.12;
  rotate: -4deg;
}

.ylf-benefit__tile {
  transition:
    rotate 480ms var(--ylf-ease-spring),
    scale 480ms var(--ylf-ease-spring);
}

.ylf-benefit:hover .ylf-benefit__tile {
  rotate: -8deg;
  scale: 1.06;
}

.ylf-benefit__lit {
  color: var(--tile);
  background: color-mix(in srgb, var(--tile) 12%, var(--ylf-surface));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tile) 28%, transparent);
}

.ylf-benefit-count {
  color: #b45309;
  background: color-mix(in srgb, #fbbf24 18%, var(--ylf-surface));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, #f59e0b 30%, transparent);
}

.dark .ylf-benefit-count {
  color: #fcd34d;
}

/* ---------------- 云币 与 会员 ---------------- */
.ylf-coin-strip {
  background: linear-gradient(120deg, #e6f2ff, #fff7ec);
  border: 1px solid color-mix(in srgb, #7dd3fc 60%, transparent);
}

.dark .ylf-coin-strip {
  background: linear-gradient(
    120deg,
    color-mix(in srgb, #3b82f6 12%, var(--ylf-surface)),
    color-mix(in srgb, #f59e0b 8%, var(--ylf-surface))
  );
  border-color: color-mix(in srgb, #38bdf8 24%, transparent);
}

.ylf-coin-card {
  background: color-mix(in srgb, var(--ylf-surface) 86%, transparent);
  border: 1px solid color-mix(in srgb, var(--ui-border-muted) 80%, transparent);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.ylf-coin-plus {
  color: var(--ui-text-muted);
  background: var(--ylf-surface);
  box-shadow: 0 6px 16px -10px color-mix(in srgb, #0b82c4 60%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .ylf-plan,
  .ylf-plan__cloud,
  .ylf-plan__sun,
  .ylf-benefit,
  .ylf-benefit__mark,
  .ylf-benefit__tile {
    transition: none;
  }

  .ylf-plan:hover,
  .ylf-benefit:hover {
    translate: none;
  }
}
</style>

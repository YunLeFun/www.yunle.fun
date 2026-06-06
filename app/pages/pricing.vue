<script setup lang="ts">
import type { BillingCycle, PlanId } from '~/types/payment'

const { data: page } = await useAsyncData('pricing', () => queryCollection('pricing').first())

interface PricingFaqItem {
  label: string
  content: string
  to?: string
}

const title = page.value?.seo?.title || page.value?.title
const description = page.value?.seo?.description || page.value?.description
const faqItems = computed(() => (page.value?.faq.items ?? []) as PricingFaqItem[])
const logoIcons = computed(() => page.value?.logos.icons ?? [])

useSeoMeta({
  title,
  ogTitle: title,
  description,
  ogDescription: description,
})

// 支付相关
const { user } = useTcbAuth()
const toast = useToast()
const payment = usePayment()
const showPaymentModal = ref(false)

// H5 跳转支付后回到本页：尝试恢复轮询，让用户看到结果
onMounted(() => {
  const resumed = payment.resumePendingOrder()
  if (resumed)
    showPaymentModal.value = true
})

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
      label: '立即订阅',
    },
    {
      ...basePlan,
      title: '年付会员',
      cycle: 'year' as BillingCycle,
      price: plan.price.year,
      billingCycle: '/年',
      label: '立即订阅',
      highlight: true,
    },
  ]
})

/**
 * 点击套餐按钮
 */
function handlePurchase(planId: PlanId, cycle: BillingCycle) {
  if (!user.value) {
    toast.add({ title: '请先登录后再购买', color: 'warning' })
    navigateTo(`/login?redirect=/pricing`)
    return
  }

  payment.selectPlan(planId, cycle)
  showPaymentModal.value = true
}

/**
 * 切换计费周期
 */
function handleSwitchCycle(cycle: 'month' | 'year') {
  if (!payment.selectedPlan.value)
    return
  payment.selectPlan(payment.selectedPlan.value, cycle)
}

function handleConfirmPay() {
  payment.createOrder()
}

function handleClose() {
  showPaymentModal.value = false
  payment.reset()
}
</script>

<template>
  <div v-if="page">
    <UPageHero
      :title="page.title"
      :description="page.description"
    >
      <template #top>
        <HeroBackground />
      </template>

      <template #headline>
        <span class="ylf-eyebrow">{{ page.headline }}</span>
      </template>
    </UPageHero>

    <UContainer>
      <div class="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto">
        <UPricingPlan
          v-for="(plan, index) in billingPlans"
          :key="index"
          v-bind="plan"
          :price="plan.price"
          :billing-cycle="plan.billingCycle"
          :highlight="plan.highlight"
          :button="{
            ...plan.button,
            label: plan.label,
            onClick: () => handlePurchase(plan.planId as PlanId, plan.cycle),
          }"
        />
      </div>
    </UContainer>

    <UPageSection>
      <UPageLogos>
        <UIcon
          v-for="icon in logoIcons"
          :key="icon"
          :name="icon"
          class="h-12 w-12 shrink-0 text-primary/70 dark:text-primary/80"
        />
      </UPageLogos>
    </UPageSection>

    <UPageSection
      :title="page.faq.title"
      :description="page.faq.description"
    >
      <UAccordion
        :items="faqItems"
        :unmount-on-hide="false"
        :default-value="['0']"
        type="multiple"
        class="mx-auto max-w-3xl"
        :ui="{
          trigger: 'text-base text-highlighted',
          body: 'text-base text-muted',
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
    </UPageSection>

    <!-- 支付弹窗 -->
    <PaymentModal
      v-model:open="showPaymentModal"
      :plan-name="payment.selectedPlanName.value"
      :price="payment.selectedPlanPrice.value"
      :billing-cycle="payment.selectedCycle.value"
      :phase="payment.phase.value"
      :loading="payment.loading.value"
      :error-message="payment.errorMessage.value"
      :code-url="payment.currentOrder.value?.codeUrl"
      :plan-id="payment.selectedPlan.value ?? undefined"
      @confirm="handleConfirmPay"
      @close="handleClose"
      @switch-cycle="handleSwitchCycle"
    />
  </div>
</template>

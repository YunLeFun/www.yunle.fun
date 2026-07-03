<script setup lang="ts">
import type { BillingCycle, PlanId } from '~/types/payment'
import { useTcbAuthSession } from '~/composables/auth/useAuthSession'

const props = withDefaults(defineProps<{
  planId?: PlanId
  cycle?: BillingCycle
}>(), {
  cycle: 'month',
})

const emit = defineEmits<{
  close: []
}>()

const { user, authReady, checkAuthStatus } = useTcbAuthSession()
const toast = useToast()
const payment = usePayment()
const showPaymentModal = ref(false)

async function openPaymentFlow() {
  if (!authReady.value)
    await checkAuthStatus()

  const resumed = payment.resumePendingOrder()
  if (resumed) {
    showPaymentModal.value = true
    return
  }

  if (!props.planId) {
    emit('close')
    return
  }

  if (!user.value) {
    toast.add({ title: '请先登录后再购买', color: 'warning' })
    await navigateTo('/login?redirect=/pricing')
    emit('close')
    return
  }

  payment.selectPlan(props.planId, props.cycle)
  showPaymentModal.value = true
}

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
  emit('close')
}

onMounted(() => {
  void openPaymentFlow()
})
</script>

<template>
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
</template>

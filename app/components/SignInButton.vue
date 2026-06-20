<script setup lang="ts">
/**
 * 每日签到按钮（方案 B 后退化为「自动领取」的状态展示 + 手动兜底）。
 *
 * 正常情况下登录后已由 app.vue 自动领取，这里主要展示「今日已领 +X」；
 * 若自动领取失败仍可点击补领。免费 1 / 会员 2 云币，按东八区每日一次（服务端幂等）。
 */
const { user } = useTcbAuth()
const { signedToday, reward, submitting, fetchStatus, signIn } = useSignIn()
const toast = useToast()

onMounted(() => {
  if (user.value)
    fetchStatus()
})
watch(() => user.value?.id, (id) => {
  if (id)
    fetchStatus()
})

async function handleSignIn() {
  if (signedToday.value || submitting.value)
    return
  try {
    const res = await signIn()
    if (res.alreadySigned)
      toast.add({ title: '今日已领取', color: 'neutral' })
    else
      toast.add({ title: `已领取 +${res.reward} 云币`, icon: 'i-lucide-coins', color: 'success' })
  }
  catch (err) {
    toast.add({
      title: '签到失败',
      description: err instanceof Error ? err.message : '请稍后重试',
      color: 'error',
    })
  }
}
</script>

<template>
  <UButton
    :icon="signedToday ? 'i-lucide-calendar-check' : 'i-lucide-calendar-plus'"
    :color="signedToday ? 'neutral' : 'primary'"
    :variant="signedToday ? 'subtle' : 'solid'"
    :loading="submitting"
    :disabled="signedToday"
    @click="handleSignIn"
  >
    {{ signedToday ? `今日已领 +${reward} 云币` : `领取 +${reward} 云币` }}
  </UButton>
</template>

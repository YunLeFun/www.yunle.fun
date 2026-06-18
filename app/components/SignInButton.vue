<script setup lang="ts">
/**
 * 每日签到按钮。免费 1 / 会员 2 云币，按东八区每日一次。
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
      toast.add({ title: '今日已签到', color: 'neutral' })
    else
      toast.add({ title: `签到成功，+${res.reward} 云币`, icon: 'i-lucide-coins', color: 'success' })
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
    {{ signedToday ? '今日已签到' : `签到 +${reward} 云币` }}
  </UButton>
</template>

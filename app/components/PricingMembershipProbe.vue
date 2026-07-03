<script setup lang="ts">
import { useTcbAuthSession } from '~/composables/auth/useAuthSession'

interface PricingMembershipView {
  isMember: boolean
  name: string
  expire: string
}

const emit = defineEmits<{
  update: [view: PricingMembershipView]
}>()

const { user, authReady, checkAuthStatus } = useTcbAuthSession()
const { isActive, state, refresh } = useMembership()

function formatExpire(ts?: number) {
  if (!ts)
    return '—— / ——'
  const d = new Date(ts)
  return `${d.getFullYear()} / ${String(d.getMonth() + 1).padStart(2, '0')}`
}

function emitView() {
  emit('update', {
    isMember: isActive.value,
    name: user.value?.nickname || user.value?.login || '晴空会员',
    expire: formatExpire(state.value?.expireAt),
  })
}

onMounted(async () => {
  if (!authReady.value)
    await checkAuthStatus()
  await refresh()
  emitView()
})

watch(
  [() => user.value?.id, isActive, () => state.value?.expireAt],
  () => emitView(),
)
</script>

<template>
  <span hidden />
</template>

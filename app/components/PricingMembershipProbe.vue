<script setup lang="ts">
import { useTcbAuthSession } from '~/composables/auth/useAuthSession'

interface PricingMembershipView {
  isMember: boolean
  name: string
  expire: string
  expireAt: number | null
  cycle: 'month' | 'year'
  serial: string
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

/** 用户 ID 末 8 位，四位一组，作为卡片背面的会员编号 */
function formatSerial(id?: string) {
  if (!id)
    return ''
  const tail = id.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase()
  return tail.replace(/(.{4})(?=.)/g, '$1 ')
}

function emitView() {
  emit('update', {
    isMember: isActive.value,
    name: user.value?.nickname || user.value?.login || '晴空会员',
    expire: formatExpire(state.value?.expireAt),
    expireAt: state.value?.expireAt ?? null,
    cycle: state.value?.activeCycle === 'year' ? 'year' : 'month',
    serial: formatSerial(user.value?.id),
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

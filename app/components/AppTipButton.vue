<script setup lang="ts">
/**
 * 应用「投币」按钮 + 支持者标识。
 *
 * 1 云币/次，每应用每日上限 2 次。投币计入应用热度（支持榜），
 * 首次投币成为该应用「支持者」。给自己的应用不可投币。
 */
import type { AppSupport } from '~/composables/useAppTips'
import type { AppRecord } from '~/types/app'

const props = defineProps<{
  app: Pick<AppRecord, 'slug' | 'name' | 'ownerId'>
}>()

const { user } = useTcbAuth()
const { getAppSupport, tip } = useAppTips()
const toast = useAppToast()

const support = ref<AppSupport | null>(null)
const submitting = ref(false)

const isOwner = computed(() => !!user.value && user.value.id === props.app.ownerId)

async function load() {
  support.value = await getAppSupport(props.app.slug)
}
onMounted(load)
watch(() => props.app.slug, load)

async function handleTip() {
  if (submitting.value || isOwner.value)
    return
  if (!user.value) {
    navigateTo(`/login?redirect=/apps/${props.app.slug}`)
    return
  }
  submitting.value = true
  try {
    const res = await tip(props.app.slug)
    toast.add({
      title: '投币成功，热度 +1',
      description: res.isNewSupporter
        ? '你已成为该应用的支持者 🎉'
        : `今日还可为它投 ${res.remainingToday} 次`,
      icon: 'i-lucide-coins',
      color: 'success',
    })
    await load()
  }
  catch (err) {
    const msg = err instanceof Error ? err.message : '请稍后重试'
    toast.add({
      title: '投币未成功',
      description: msg,
      color: msg.includes('余额不足') || msg.includes('上限') ? 'warning' : 'error',
    })
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-3">
    <UButton
      icon="i-lucide-coins"
      :color="support?.tippedByMe ? 'primary' : 'neutral'"
      :variant="support?.tippedByMe ? 'soft' : 'outline'"
      :loading="submitting"
      :disabled="isOwner"
      @click="handleTip"
    >
      投币
      <span v-if="support && support.totalCoins > 0" class="opacity-70">· {{ support.totalCoins }}</span>
    </UButton>

    <span
      v-if="support?.tippedByMe"
      class="inline-flex items-center gap-1 text-xs text-primary font-medium"
    >
      <UIcon name="i-lucide-heart-handshake" class="size-3.5" />
      支持者
    </span>
    <span v-if="support && support.supporterCount > 0" class="text-xs text-muted">
      {{ support.supporterCount }} 人支持
    </span>
    <span v-if="isOwner" class="text-xs text-muted">
      这是你的应用
    </span>
  </div>
</template>

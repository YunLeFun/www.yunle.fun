<script setup lang="ts">
const props = defineProps<{
  provider: string
  label: string
  icon: string
  iconClass?: string
  bound: boolean
  accountLogin?: string
  loading: boolean
  providersLoading: boolean
}>()

const emit = defineEmits<{
  bind: []
  unbind: []
}>()

const description = computed(() => {
  if (!props.bound)
    return `绑定后可使用 ${props.label} 账号登录`
  if (props.accountLogin)
    return `已绑定 @${props.accountLogin.replace(/^@/, '')}，可使用 ${props.label} 登录`
  return `已绑定，可使用 ${props.label} 登录`
})
</script>

<template>
  <div class="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
    <div class="flex min-w-0 flex-1 items-center gap-3">
      <div class="size-9 flex shrink-0 items-center justify-center rounded-lg bg-elevated">
        <UIcon :name="props.icon" class="text-lg" :class="props.iconClass" />
      </div>
      <div class="min-w-0 space-y-1">
        <p class="text-sm font-medium">
          {{ props.label }}
        </p>
        <p v-if="props.providersLoading" class="truncate text-xs text-muted">
          正在查询绑定状态...
        </p>
        <p v-else class="truncate text-xs text-muted">
          {{ description }}
        </p>
      </div>
    </div>
    <div class="flex shrink-0 items-center gap-2 ps-12 sm:ps-0">
      <UBadge
        v-if="props.providersLoading"
        label="查询中"
        color="info"
        variant="subtle"
        size="sm"
      />
      <template v-else>
        <UBadge
          :label="props.bound ? '已绑定' : '未绑定'"
          :color="props.bound ? 'success' : 'warning'"
          variant="subtle"
          size="sm"
        />
        <UButton
          v-if="props.bound"
          label="解绑"
          color="error"
          variant="outline"
          size="xs"
          icon="i-lucide-unlink"
          :loading="props.loading"
          @click="emit('unbind')"
        />
        <UButton
          v-else
          label="绑定"
          color="primary"
          variant="outline"
          size="xs"
          :icon="props.icon"
          :loading="props.loading"
          @click="emit('bind')"
        />
      </template>
    </div>
  </div>
</template>

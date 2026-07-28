<script setup lang="ts">
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

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
        <Icon :name="props.icon" class="text-lg" :class="props.iconClass" />
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
      <Badge v-if="props.providersLoading" variant="outline">
        查询中
      </Badge>
      <template v-else>
        <Badge :variant="props.bound ? 'secondary' : 'outline'">
          {{ props.bound ? '已绑定' : '未绑定' }}
        </Badge>
        <Button
          v-if="props.bound"
          variant="destructive"
          size="xs"
          :disabled="props.loading"
          @click="emit('unbind')"
        >
          <Spinner v-if="props.loading" />
          <Icon v-else name="i-lucide-unlink" />
          解绑
        </Button>
        <Button
          v-else
          variant="outline"
          size="xs"
          :disabled="props.loading"
          @click="emit('bind')"
        >
          <Spinner v-if="props.loading" />
          <Icon v-else :name="props.icon" />
          绑定
        </Button>
      </template>
    </div>
  </div>
</template>

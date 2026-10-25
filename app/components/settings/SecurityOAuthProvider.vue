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
  <div class="oauth-provider">
    <div class="flex min-w-0 flex-1 items-center gap-3">
      <div class="size-12 flex shrink-0 items-center justify-center rounded-2xl bg-elevated">
        <Icon :name="props.icon" class="text-lg" :class="props.iconClass" />
      </div>
      <div class="min-w-0 space-y-1">
        <p class="text-[0.9375rem] font-semibold">
          {{ props.label }}
        </p>
        <p v-if="props.providersLoading" class="text-[0.8125rem] text-muted break-words">
          正在查询绑定状态...
        </p>
        <p v-else class="text-[0.8125rem] text-muted break-words">
          {{ description }}
        </p>
      </div>
    </div>
    <div class="oauth-provider__actions">
      <Badge v-if="props.providersLoading" variant="outline">
        查询中
      </Badge>
      <template v-else>
        <Badge class="provider-status" :class="{ 'provider-status--bound': props.bound }" :variant="props.bound ? 'secondary' : 'outline'">
          {{ props.bound ? '已绑定' : '未绑定' }}
        </Badge>
        <Button
          v-if="props.bound"
          variant="ghost"
          size="sm"
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
          size="sm"
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

<style scoped>
.oauth-provider {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding-block: 1.25rem;
}
.oauth-provider__actions {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.25rem;
}
.oauth-provider__actions :deep([data-slot='button']) {
  min-height: 2.75rem;
}
.provider-status {
  border: 0;
  border-radius: var(--ylf-radius-sm);
  font-size: 0.6875rem;
}
.provider-status--bound {
  color: var(--ylf-status-success-text);
  background: var(--ylf-status-success-soft);
}
</style>

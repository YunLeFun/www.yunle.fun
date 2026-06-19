<script setup lang="ts">
/**
 * 通知铃铛 + 未读红点（仅登录时显示）。点击打开通知弹窗。
 */
const { user } = useTcbAuth()
const { unread, refreshUnread } = useNotifications()
const open = ref(false)

onMounted(() => {
  if (user.value)
    refreshUnread()
})
watch(() => user.value?.id, (id) => {
  if (id)
    refreshUnread()
  else
    unread.value = 0
})
</script>

<template>
  <template v-if="user">
    <UButton
      icon="i-lucide-bell"
      color="neutral"
      variant="ghost"
      class="relative"
      aria-label="通知"
      @click="open = true"
    >
      <span
        v-if="unread > 0"
        class="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-medium leading-none text-white"
      >
        {{ unread > 99 ? '99+' : unread }}
      </span>
    </UButton>
    <NotificationModal v-model:open="open" />
  </template>
</template>

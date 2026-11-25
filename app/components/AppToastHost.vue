<script setup lang="ts">
import type AppToaster from './AppToaster.vue'

const { toasts, remove } = useAppToast()
const toaster = shallowRef<typeof AppToaster>()
const loadFailed = shallowRef(false)

onMounted(() => {
  watch(() => toasts.value.length > 0, async (hasToasts) => {
    if (!hasToasts || toaster.value || loadFailed.value)
      return

    try {
      toaster.value = (await import('./AppToaster.vue')).default
    }
    catch {
      // 跳转失败时通知分块也可能不可用，保留重新打开目标页的操作。
      loadFailed.value = true
    }
  }, { immediate: true })
})
</script>

<template>
  <component :is="toaster" v-if="toasts.length && toaster" />
  <div v-else-if="toasts.length && loadFailed" class="fixed inset-x-0 top-0 z-[100] flex flex-col gap-2 p-4 sm:inset-x-auto sm:top-auto sm:right-0 sm:bottom-0 sm:max-w-[26rem]">
    <div v-for="toast in toasts" :key="toast.id" role="alert" class="rounded-xl border bg-background p-4 text-sm shadow-lg">
      <p class="font-semibold">
        {{ toast.title }}
      </p>
      <p v-if="toast.description" class="mt-1 text-muted-foreground">
        {{ toast.description }}
      </p>
      <div class="mt-2 flex items-center gap-3">
        <a v-if="toast.action" :href="toast.action.href" :target="toast.action.target" :rel="toast.action.target === '_blank' ? 'noopener noreferrer' : undefined" class="text-primary underline">
          {{ toast.action.label }}
        </a>
        <button type="button" class="ml-auto text-muted-foreground" @click="remove(toast.id)">
          关闭通知
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 通知列表弹窗（懒加载分页）。打开即拉列表并标记全部已读、清红点。
 */
import type { NotificationItem } from '~/types/social'
import { displayUserName } from '~/utils/mask'

const open = defineModel<boolean>('open', { default: false })
const { list, markRead, unread } = useNotifications()

const items = ref<NotificationItem[]>([])
const loading = ref(false)
const loaded = ref(false)
const nextSkip = ref<number | null>(0)

async function loadMore() {
  if (loading.value || nextSkip.value === null)
    return
  loading.value = true
  try {
    const res = await list({ skip: nextSkip.value, limit: 20 })
    items.value.push(...res.items)
    nextSkip.value = res.nextSkip
  }
  finally {
    loading.value = false
    loaded.value = true
  }
}

watch(open, async (v) => {
  if (!v || loaded.value)
    return
  await loadMore()
  // 打开即全部已读，清红点
  if (unread.value > 0) {
    markRead()
    items.value = items.value.map(i => ({ ...i, read: true }))
  }
})

function fmt(ts: number) {
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}
</script>

<template>
  <UModal v-model:open="open" title="通知">
    <template #content>
      <div class="p-4 sm:p-5">
        <h3 class="ylf-dreamy-display mb-4 text-lg text-highlighted">
          通知
        </h3>

        <div v-if="!loaded && loading" class="flex justify-center py-10">
          <UIcon name="i-lucide-loader-2" class="animate-spin text-2xl text-muted" />
        </div>
        <div v-else-if="items.length === 0" class="py-10 text-center text-sm text-muted">
          还没有通知
        </div>
        <div v-else class="max-h-[60vh] space-y-1 overflow-y-auto">
          <NuxtLink
            v-for="item in items"
            :key="item.id"
            :to="item.actor.login ? `/u/${item.actor.login}` : `/u/${item.actor.userId}`"
            class="flex items-center gap-3 rounded-2xl p-2.5 transition-colors hover:bg-elevated/60"
            :class="item.read ? '' : 'bg-primary/5'"
            @click="open = false"
          >
            <MemberAvatar :src="item.actor.avatar" :alt="displayUserName(item.actor.nickname)" size="md" />
            <div class="min-w-0 flex-1">
              <p class="text-sm text-highlighted">
                <span class="font-medium">{{ displayUserName(item.actor.nickname) }}</span>
                <span class="text-muted"> 关注了你</span>
              </p>
              <span class="text-xs text-muted">{{ fmt(item.createdAt) }}</span>
            </div>
            <UIcon name="i-lucide-user-plus" class="shrink-0 text-muted" />
          </NuxtLink>

          <div v-if="nextSkip !== null" class="pt-2 text-center">
            <UButton :loading="loading" label="加载更多" color="neutral" variant="ghost" size="xs" @click="loadMore" />
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
/**
 * 通知列表弹窗（懒加载分页）。打开即拉列表并标记全部已读、清红点。
 */
import type { NotificationItem } from '~/types/social'
import { displayUserName } from '~/utils/mask'

const open = defineModel<boolean>('open', { default: false })
const { userId, list, markRead, unread, restricted } = useNotifications()

const items = ref<NotificationItem[]>([])
const loading = ref(false)
const loaded = ref(false)
const nextSkip = ref<number | null>(0)
const loadError = shallowRef('')

async function loadMore() {
  if (loading.value || nextSkip.value === null || restricted.value)
    return false
  const uid = userId.value
  loading.value = true
  loadError.value = ''
  try {
    const res = await list({ skip: nextSkip.value, limit: 20 })
    if (userId.value !== uid || restricted.value)
      return false
    items.value.push(...res.items)
    nextSkip.value = res.nextSkip
    return true
  }
  catch {
    if (userId.value === uid)
      loadError.value = '通知暂时无法加载，请稍后重试。'
    return false
  }
  finally {
    if (userId.value === uid) {
      loading.value = false
      loaded.value = true
    }
  }
}

async function loadInitial() {
  items.value = []
  nextSkip.value = 0
  loaded.value = false
  const uid = userId.value
  if (!await loadMore() || userId.value !== uid || restricted.value)
    return
  // 打开即全部已读，清红点
  if (unread.value > 0) {
    try {
      if (await markRead() && userId.value === uid)
        items.value = items.value.map(i => ({ ...i, read: true }))
    }
    catch {
      if (userId.value === uid)
        loadError.value = '通知已读状态暂时无法更新，请稍后重试。'
    }
  }
}

watch(open, (v) => {
  if (v && !loaded.value)
    void loadInitial()
}, { immediate: true })

watch(userId, () => {
  items.value = []
  nextSkip.value = 0
  loaded.value = false
  loading.value = false
  loadError.value = ''
  if (open.value)
    void loadInitial()
})

function fmt(ts: number) {
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}
</script>

<template>
  <AppModal v-model:open="open" title="通知">
    <template #content>
      <div class="p-4 sm:p-5">
        <h3 class="ylf-dreamy-display mb-4 text-lg text-highlighted">
          通知
        </h3>

        <TestAccountNotice v-if="restricted" feature="notifications" />
        <div v-else-if="loadError" class="space-y-3 py-6 text-sm" role="alert">
          <p class="text-error">
            {{ loadError }}
          </p>
          <AppButton color="neutral" variant="outline" label="重试" :loading="loading" @click="loadInitial" />
        </div>
        <div v-else-if="!loaded && loading" class="flex justify-center py-10">
          <Icon name="i-lucide-loader-2" class="animate-spin text-2xl text-muted" />
        </div>
        <div v-else-if="items.length === 0" class="py-10 text-center text-sm text-muted">
          还没有通知
        </div>
        <div v-else class="max-h-[60vh] space-y-1 overflow-y-auto">
          <template
            v-for="item in items"
            :key="item.id"
          >
            <NuxtLink
              v-if="item.type === 'follow'"
              :to="item.actor.login ? `/u/${item.actor.login}` : `/u/${item.actor.userId}`"
              class="flex items-center gap-3 rounded-2xl p-2.5 transition-colors hover:bg-elevated/60"
              :class="item.read ? '' : 'bg-primary/5'"
              @click="open = false"
            >
              <MemberAvatar
                :src="item.actor.avatar"
                :alt="displayUserName(item.actor.nickname)"
                :is-member="item.actor.isMember"
                size="md"
              />
              <div class="min-w-0 flex-1">
                <p class="text-sm text-highlighted">
                  <span class="font-medium">{{ displayUserName(item.actor.nickname) }}</span>
                  <span class="text-muted"> 关注了你</span>
                </p>
                <span class="text-xs text-muted">{{ fmt(item.createdAt) }}</span>
              </div>
              <Icon name="i-lucide-user-plus" class="shrink-0 text-muted" />
            </NuxtLink>

            <NuxtLink
              v-else
              to="/wallet"
              class="flex items-center gap-3 rounded-2xl p-2.5 transition-colors hover:bg-elevated/60"
              :class="item.read ? '' : 'bg-primary/5'"
              @click="open = false"
            >
              <span class="ylf-member-mark flex size-10 shrink-0 items-center justify-center rounded-full">
                <Icon name="i-lucide-gift" class="size-5" />
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-highlighted">
                  {{ item.reward.rewardName }}
                </p>
                <p class="text-xs text-muted">
                  <span v-if="item.reward.coinAmount">+{{ item.reward.coinAmount }} 云币</span>
                  <span v-if="item.reward.coinAmount && item.reward.membershipDays"> · </span>
                  <span v-if="item.reward.membershipDays">会员 +{{ item.reward.membershipDays }} 天</span>
                  <span> · {{ fmt(item.createdAt) }}</span>
                </p>
              </div>
              <Icon name="i-lucide-chevron-right" class="shrink-0 text-muted" />
            </NuxtLink>
          </template>

          <div v-if="nextSkip !== null" class="pt-2 text-center">
            <AppButton :loading="loading" label="加载更多" color="neutral" variant="ghost" size="xs" @click="loadMore" />
          </div>
        </div>
      </div>
    </template>
  </AppModal>
</template>

<script setup lang="ts">
/**
 * 关注 / 粉丝列表弹窗（懒加载分页）。
 *
 * 点击主页或个人中心的「关注 / 粉丝」数字打开。每项可跳主页 + 直接关注/取关。
 * 首次打开才加载；切换 userId/type 时重置。
 */
import type { FollowListItem } from '~/types/social'

const props = defineProps<{
  userId: string
  type: 'following' | 'followers'
}>()
const open = defineModel<boolean>('open', { default: false })

const { listFollowing, listFollowers } = useFollow()

const items = ref<FollowListItem[]>([])
const loading = ref(false)
const loaded = ref(false)
const hidden = ref(false)
const nextSkip = ref<number | null>(0)

const title = computed(() => (props.type === 'following' ? '关注' : '粉丝'))

async function loadMore() {
  if (loading.value || nextSkip.value === null)
    return
  loading.value = true
  try {
    const fn = props.type === 'following' ? listFollowing : listFollowers
    const res = await fn(props.userId, { skip: nextSkip.value, limit: 20 })
    if (res.hidden)
      hidden.value = true
    items.value.push(...res.items)
    nextSkip.value = res.nextSkip
  }
  finally {
    loading.value = false
    loaded.value = true
  }
}

function reset() {
  items.value = []
  nextSkip.value = 0
  loaded.value = false
  hidden.value = false
}

watch(open, (v) => {
  if (v && !loaded.value)
    loadMore()
})
watch(() => [props.userId, props.type], () => {
  reset()
  if (open.value)
    loadMore()
})
</script>

<template>
  <UModal v-model:open="open" :title="title">
    <template #content>
      <div class="p-4 sm:p-5">
        <h3 class="ylf-dreamy-display mb-4 text-lg text-highlighted">
          {{ title }}
        </h3>

        <div v-if="!loaded && loading" class="flex justify-center py-10">
          <UIcon name="i-lucide-loader-2" class="animate-spin text-2xl text-muted" />
        </div>
        <div v-else-if="items.length === 0" class="py-10 text-center text-sm text-muted">
          {{ hidden ? `对方已隐藏${title}列表` : `还没有${title}` }}
        </div>
        <div v-else class="max-h-[60vh] space-y-1 overflow-y-auto">
          <div
            v-for="item in items"
            :key="item.userId"
            class="flex items-center gap-3 rounded-2xl p-2.5 transition-colors hover:bg-elevated/60"
          >
            <NuxtLink
              :to="item.login ? `/u/${item.login}` : `/u/${item.userId}`"
              class="flex min-w-0 flex-1 items-center gap-3"
              @click="open = false"
            >
              <MemberAvatar :src="item.avatar" :alt="item.nickname" size="md" />
              <div class="min-w-0">
                <span class="block truncate text-sm font-medium text-highlighted">{{ item.nickname || '云乐坊用户' }}</span>
                <span v-if="item.login" class="block truncate text-xs text-muted">@{{ item.login }}</span>
              </div>
            </NuxtLink>
            <FollowButton
              :target-id="item.userId"
              :relation="{ isFollowing: item.isFollowing, isFollowedBy: false }"
              size="xs"
            />
          </div>

          <div v-if="nextSkip !== null" class="pt-2 text-center">
            <UButton
              :loading="loading"
              label="加载更多"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="loadMore"
            />
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>

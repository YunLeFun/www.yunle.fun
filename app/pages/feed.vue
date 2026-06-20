<script setup lang="ts">
/**
 * 关注动态 /feed（需登录，client-only）。
 *
 * 展示「我关注的人」最近发布 / 更新的公开应用（拉模式，复用 apps）。
 * 未登录由全局 auth.global 中间件引导登录。
 */
import type { FeedItem } from '~/types/social'
import { displayUserName } from '~/utils/mask'

definePageMeta({ layout: 'default' })

useSeoMeta({
  title: '关注动态 - YunLeFun',
  description: '我关注的创作者最近发布的应用',
})

const { getFollowingFeed } = useFeed()

const items = ref<FeedItem[]>([])
const loading = ref(false)
const loaded = ref(false)
const nextSkip = ref<number | null>(0)

async function loadMore() {
  if (loading.value || nextSkip.value === null)
    return
  loading.value = true
  try {
    const res = await getFollowingFeed({ skip: nextSkip.value, limit: 20 })
    items.value.push(...res.items)
    nextSkip.value = res.nextSkip
  }
  finally {
    loading.value = false
    loaded.value = true
  }
}

onMounted(loadMore)

function formatTime(ts: number) {
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}
</script>

<template>
  <UContainer class="py-8 sm:py-10">
    <div class="mx-auto max-w-2xl space-y-5">
      <h1 class="ylf-dreamy-display text-2xl text-highlighted">
        关注动态
      </h1>

      <div v-if="!loaded && loading" class="flex justify-center py-20">
        <UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-muted" />
      </div>

      <div v-else-if="items.length === 0" class="ylf-empty-state rounded-3xl px-4 py-16 text-center">
        <UIcon name="i-lucide-rss" class="mb-4 text-5xl text-muted" />
        <p class="mb-2 text-lg text-muted">
          还没有动态
        </p>
        <p class="mb-5 text-sm text-muted">
          关注感兴趣的创作者，这里会展示 ta 们发布的应用
        </p>
        <UButton to="/apps" label="去发现应用" icon="i-lucide-compass" color="primary" variant="subtle" />
      </div>

      <div v-else class="space-y-3">
        <article v-for="item in items" :key="item.appId" class="ylf-card rounded-3xl p-5">
          <NuxtLink
            :to="item.owner.login ? `/u/${item.owner.login}` : `/u/${item.owner.userId}`"
            class="mb-3 flex items-center gap-2.5"
          >
            <MemberAvatar :src="item.owner.avatar" :alt="displayUserName(item.owner.nickname)" size="sm" />
            <span class="text-sm font-medium text-highlighted">{{ displayUserName(item.owner.nickname) }}</span>
            <span class="text-xs text-muted">发布了应用 · {{ formatTime(item.updatedAt) }}</span>
          </NuxtLink>

          <NuxtLink
            :to="`/apps/${item.slug}`"
            class="group flex items-center gap-3 rounded-2xl bg-elevated/40 p-3 transition-colors hover:bg-elevated/70"
          >
            <div class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-elevated">
              <img v-if="item.icon" :src="item.icon" :alt="item.name" class="size-7 rounded">
              <UIcon v-else name="i-lucide-box" class="text-lg text-muted" />
            </div>
            <div class="min-w-0 flex-1">
              <span class="block truncate font-medium transition-colors group-hover:text-primary">{{ item.name }}</span>
              <span v-if="item.description" class="line-clamp-1 text-sm text-muted">{{ item.description }}</span>
              <span v-else class="font-mono text-xs text-muted">{{ item.slug }}</span>
            </div>
            <UIcon name="i-lucide-chevron-right" class="shrink-0 text-muted" />
          </NuxtLink>
        </article>

        <div v-if="nextSkip !== null" class="pt-2 text-center">
          <UButton :loading="loading" label="加载更多" color="neutral" variant="ghost" size="sm" @click="loadMore" />
        </div>
      </div>
    </div>
  </UContainer>
</template>

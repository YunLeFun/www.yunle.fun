<script setup lang="ts">
/**
 * 关注动态 /feed（需登录，client-only）。
 *
 * 展示「我关注的人」最近发布 / 更新的公开应用（拉模式，复用 apps）。
 * 未登录由全局 auth.global 中间件引导登录。
 */
import type { FeedItem } from '~/types/social'
import { getAppDetailPath } from '~/utils/appRoutes'
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
  <AppContainer class="py-8 sm:py-10">
    <div class="mx-auto max-w-2xl space-y-5">
      <SubpageHero title="关注动态" description="你关注的创作者最近发布与更新的应用" />

      <!-- 首次加载：与动态卡片同形的晴空骨架 -->
      <div v-if="!loaded && loading" class="space-y-3" aria-busy="true" aria-label="正在加载关注动态">
        <div v-for="n in 3" :key="n" class="ylf-card rounded-[var(--ylf-radius-lg)] p-5">
          <div class="mb-3 flex items-center gap-2.5">
            <div class="ylf-shimmer size-8 shrink-0 rounded-full" />
            <div class="ylf-shimmer h-3.5 w-24 rounded-full" />
            <div class="ylf-shimmer h-3 w-20 rounded-full" />
          </div>
          <div class="flex items-center gap-3 rounded-2xl bg-elevated/40 p-3">
            <div class="ylf-shimmer size-11 shrink-0 rounded-xl" />
            <div class="flex-1 space-y-2">
              <div class="ylf-shimmer h-3.5 w-2/5 rounded-full" />
              <div class="ylf-shimmer h-3 w-3/4 rounded-full" />
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="items.length === 0" class="ylf-empty-state ylf-rise rounded-[var(--ylf-radius-lg)] px-4 py-16 text-center" style="--i: 1">
        <span class="feed-empty-cloud ylf-empty-cloud ylf-bob" aria-hidden="true">
          <Icon name="i-lucide-rss" class="size-7" />
        </span>
        <p class="mb-2 text-lg text-muted">
          还没有动态
        </p>
        <p class="mb-5 text-sm text-muted">
          关注感兴趣的创作者，这里会展示 ta 们发布的应用
        </p>
        <AppButton to="/apps" label="去发现应用" icon="i-lucide-compass" color="primary" variant="subtle" />
      </div>

      <div v-else class="space-y-3">
        <article
          v-for="(item, i) in items"
          :key="item.appId"
          class="ylf-card ylf-rise rounded-[var(--ylf-radius-lg)] p-5"
          :style="{ '--i': 1 + Math.min(i % 20, 8) * 0.6 }"
        >
          <NuxtLink
            :to="item.owner.login ? `/u/${item.owner.login}` : `/u/${item.owner.userId}`"
            class="feed-owner group/owner mb-3 flex min-w-0 items-center gap-2.5"
          >
            <MemberAvatar
              :src="item.owner.avatar"
              :alt="displayUserName(item.owner.nickname)"
              :is-member="item.owner.isMember"
              size="sm"
            />
            <span class="truncate text-sm font-medium text-highlighted transition-colors group-hover/owner:text-primary">{{ displayUserName(item.owner.nickname) }}</span>
            <span class="shrink-0 text-xs text-muted">发布了应用 · {{ formatTime(item.updatedAt) }}</span>
          </NuxtLink>

          <NuxtLink
            :to="getAppDetailPath({ slug: item.slug, ownerLogin: item.owner.login || undefined })"
            class="feed-app ylf-press group flex items-center gap-3 rounded-2xl bg-elevated/40 p-3 hover:bg-elevated/70"
          >
            <div class="feed-app__icon flex size-11 shrink-0 items-center justify-center rounded-xl bg-elevated">
              <img v-if="item.icon" :src="item.icon" :alt="item.name" class="size-7 rounded">
              <Icon v-else name="i-lucide-box" class="text-lg text-muted" />
            </div>
            <div class="min-w-0 flex-1">
              <span class="block truncate font-medium transition-colors group-hover:text-primary">{{ item.name }}</span>
              <span v-if="item.description" class="line-clamp-1 text-sm text-muted">{{ item.description }}</span>
              <span v-else class="font-mono text-xs text-muted">{{ item.slug }}</span>
            </div>
            <Icon name="i-lucide-chevron-right" class="feed-app__chevron shrink-0 text-muted" />
          </NuxtLink>
        </article>

        <div v-if="nextSkip !== null" class="pt-2 text-center">
          <AppButton :loading="loading" label="加载更多" color="neutral" variant="ghost" size="sm" @click="loadMore" />
        </div>
      </div>
    </div>
  </AppContainer>
</template>

<style scoped>
.feed-empty-cloud {
  width: 3.5rem;
  height: 3.5rem;
  margin-bottom: 1rem;
}

/* 应用卡：悬停时图标像云一样轻轻弹起、箭头向前探，按下由 .ylf-press 回弹。 */
.feed-app {
  transition:
    background-color var(--ylf-duration-fast) var(--ylf-ease-standard),
    scale var(--ylf-duration-slow) var(--ylf-ease-spring);
}

.feed-app:active {
  transition-duration: var(--ylf-duration-fast), var(--ylf-duration-press);
}

.feed-app__icon,
.feed-app__chevron {
  transition: translate var(--ylf-duration-slow) var(--ylf-ease-spring);
}

.feed-app:hover .feed-app__icon {
  translate: 0 -3px;
}

.feed-app:hover .feed-app__chevron {
  translate: 3px 0;
}

@media (prefers-reduced-motion: reduce) {
  .feed-app:hover .feed-app__icon,
  .feed-app:hover .feed-app__chevron {
    translate: none;
  }
}
</style>

<script setup lang="ts">
import type { ExplorerApp } from '~/types/app-explorer'
import YlfCloud from '@yunlefun/vue/components/YlfCloud.vue'
import { computed } from 'vue'
import AppDiscoveryCard from './AppDiscoveryCard.vue'

const props = defineProps<{
  apps: ExplorerApp[]
  loading: boolean
  error: string | null
  hasFilters: boolean
}>()

defineEmits<{
  retry: []
  clear: []
}>()

// 结果集合变化时重建网格，让卡片按顺序重新飘入。
const listKey = computed(() => props.apps.map(app => app._id || app.slug).join('|'))
</script>

<template>
  <section aria-label="应用列表">
    <div v-if="loading" class="app-discovery-grid" aria-busy="true" aria-label="正在加载应用">
      <div
        v-for="index in 6"
        :key="index"
        data-testid="app-skeleton"
        class="app-discovery-grid__skeleton"
      >
        <AppSkeleton class="h-13 w-13 rounded-2xl" />
        <AppSkeleton class="mt-5 h-5 w-2/3" />
        <AppSkeleton class="mt-4 h-3 w-full" />
        <AppSkeleton class="mt-2 h-3 w-4/5" />
      </div>
    </div>

    <div v-else-if="error" class="app-discovery-grid__state" role="alert">
      <YlfCloud shape="puff" face class="app-discovery-grid__state-cloud is-worried" />
      <h2>应用云暂时飘远了</h2>
      <p>{{ error }}</p>
      <AppButton
        data-testid="retry-apps"
        label="重新加载"
        icon="i-lucide-refresh-cw"
        @click="$emit('retry')"
      />
    </div>

    <div v-else-if="!apps.length" class="app-discovery-grid__state">
      <YlfCloud shape="puff" face class="app-discovery-grid__state-cloud" />
      <template v-if="hasFilters">
        <h2>没有找到匹配的应用</h2>
        <p>换个关键词或分类，也许会遇到另一朵云。</p>
        <AppButton
          data-testid="clear-app-filters"
          label="清除筛选"
          color="neutral"
          variant="soft"
          @click="$emit('clear')"
        />
      </template>
      <template v-else>
        <h2>暂时还没有公开应用</h2>
        <p>新的创意正在云端汇聚，稍后再来看看吧。</p>
      </template>
    </div>

    <div v-else :key="listKey" class="app-discovery-grid">
      <AppDiscoveryCard
        v-for="(app, index) in apps"
        :key="app._id || app.slug"
        :app="app"
        :style="{ '--i': index }"
      />
    </div>
  </section>
</template>

<style scoped>
.app-discovery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr));
  gap: 1rem;
}

.app-discovery-grid__skeleton {
  min-height: 19rem;
  border: 1px solid var(--ui-border);
  border-radius: 1.5rem;
  padding: 1.35rem;
  background: color-mix(in srgb, var(--ui-bg) 86%, transparent);
}

.app-discovery-grid__state {
  display: grid;
  min-height: 20rem;
  place-items: center;
  align-content: center;
  gap: 0.75rem;
  border: 1px dashed color-mix(in srgb, var(--ui-border) 80%, transparent);
  border-radius: 1.5rem;
  padding: 2rem;
  background: color-mix(in srgb, var(--ui-bg) 68%, transparent);
  text-align: center;
}

.app-discovery-grid__state h2 {
  font-size: 1.15rem;
  font-weight: 700;
}

.app-discovery-grid__state p {
  max-width: 30rem;
  color: var(--ui-text-muted);
}

.app-discovery-grid__state-cloud {
  --ylf-cloud-face-opacity: 0.85;
  width: 8rem;
  filter: drop-shadow(0 10px 14px rgb(40 90 160 / 18%));
  /* 设计规范不播放循环背景动画：云朵飘两下就停住。 */
  animation: discovery-cloud-bob 4.5s ease-in-out 2;
}

/* 出错时云朵歪着头、飘得更慢，像是迷了路。 */
.app-discovery-grid__state-cloud.is-worried {
  rotate: -6deg;
  animation-duration: 6s;
}

@keyframes discovery-cloud-bob {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-8px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .app-discovery-grid__state-cloud {
    animation: none;
  }
}

@media (min-width: 768px) {
  .app-discovery-grid {
    gap: 1.25rem;
  }
}
</style>

<script setup lang="ts">
import type { ExplorerApp } from '~/types/app-explorer'
import { computed } from 'vue'
import { useSsoAccountState } from '~/composables/useSsoAccountState'
import { ssoExplorerApps } from '~/config/sso-explorer'
import AppSsoCloudMap from './AppSsoCloudMap.vue'

const props = defineProps<{
  apps: ExplorerApp[]
  loading: boolean
}>()

defineEmits<{
  scrollToGrid: []
}>()

const categoryCount = computed(() => new Set(props.apps.map(app => app.category)).size)
const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const accountState = useSsoAccountState('/explore')
</script>

<template>
  <section class="app-explorer-hero">
    <div class="app-explorer-hero__intro">
      <div>
        <p class="app-explorer-hero__eyebrow">
          云乐坊应用集合
        </p>
        <h1>云端应用图谱</h1>
        <p class="app-explorer-hero__lead">
          从同一个账号出发，探索创作工具、小游戏和日常灵感。
        </p>
      </div>

      <dl
        class="app-explorer-hero__stats"
        aria-label="应用图谱统计"
        aria-live="polite"
        :aria-busy="loading"
      >
        <div>
          <dt>公开应用</dt>
          <dd>{{ loading ? '—' : apps.length }}</dd>
        </div>
        <div>
          <dt>创意分类</dt>
          <dd>{{ loading ? '—' : categoryCount }}</dd>
        </div>
        <div>
          <dt>统一账号应用</dt>
          <dd>{{ ssoExplorerApps.length }}</dd>
        </div>
      </dl>
    </div>

    <AppSsoCloudMap
      :apps="ssoExplorerApps"
      :account="accountState"
      :reduced-motion="prefersReducedMotion"
      @scroll-to-grid="$emit('scrollToGrid')"
    />
  </section>
</template>

<style scoped>
.app-explorer-hero {
  display: grid;
  gap: 2rem;
}

.app-explorer-hero__intro {
  display: grid;
  gap: 1.5rem;
  align-items: end;
}

.app-explorer-hero__eyebrow {
  color: var(--ui-primary);
  font-size: 0.8rem;
  font-weight: 600;
}

.app-explorer-hero h1 {
  margin-top: 0.6rem;
  color: var(--ui-text-highlighted);
  font-size: clamp(2.15rem, 5vw, 3.75rem);
  font-weight: 750;
  letter-spacing: -0.04em;
  line-height: 1.15;
}

.app-explorer-hero__lead {
  max-width: 42rem;
  margin-top: 0.85rem;
  color: var(--ui-text-muted);
  font-size: 0.95rem;
  line-height: 1.8;
}

.app-explorer-hero__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
  margin: 0;
}

.app-explorer-hero__stats div {
  min-width: 0;
  border-left: 1px solid var(--ui-border-muted);
  padding-left: 1rem;
}

.app-explorer-hero__stats dt {
  color: var(--ui-text-muted);
  font-size: 0.7rem;
}

.app-explorer-hero__stats dd {
  margin: 0.35rem 0 0;
  color: var(--ui-text-highlighted);
  font-size: 1.8rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

@media (min-width: 1024px) {
  .app-explorer-hero__intro {
    grid-template-columns: minmax(0, 1fr) minmax(20rem, 0.4fr);
  }
}
</style>

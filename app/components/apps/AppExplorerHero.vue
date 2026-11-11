<script setup lang="ts">
import type { ExplorerApp } from '~/types/app-explorer'
import { computed } from 'vue'
import { useSsoAccountState } from '~/composables/useSsoAccountState'
import { ssoExplorerApps } from '~/config/sso-explorer'
import AppCloudTrain from './AppCloudTrain.vue'

const props = defineProps<{
  apps: ExplorerApp[]
  loading: boolean
}>()

defineEmits<{
  scrollToGrid: []
}>()

const categoryCount = computed(() => new Set(props.apps.map(app => app.category)).size)
const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const mounted = useMounted()
const accountState = useSsoAccountState('/explore')
</script>

<template>
  <section class="app-explorer-hero" data-cloud-journey="/explore">
    <div class="app-explorer-hero__intro">
      <div>
        <h1 class="ylf-display">
          浏览应用
        </h1>
        <p class="app-explorer-hero__lead">
          搭上云海列车，点选车厢打开应用。
        </p>
      </div>
      <dl class="app-explorer-hero__stats" aria-label="应用统计" aria-live="polite" :aria-busy="loading">
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
    <AppCloudTrain
      :apps="ssoExplorerApps"
      :account="accountState"
      :reduced-motion="mounted && prefersReducedMotion"
      @scroll-to-grid="$emit('scrollToGrid')"
    />
  </section>
</template>

<style scoped>
.app-explorer-hero__intro {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  justify-content: space-between;
  gap: 1.2rem;
  color: #fff;
  text-shadow: 0 1px 8px #21456570;
}
.app-explorer-hero h1 {
  font-size: clamp(2.125rem, 1.65rem + 1.8vw, 2.875rem);
  letter-spacing: 0.04em;
}
.app-explorer-hero__lead {
  margin-top: 0.8rem;
  font-size: 0.95rem;
}
.app-explorer-hero__stats,
.app-explorer-hero__stats div {
  display: flex;
  align-items: baseline;
}
.app-explorer-hero__stats {
  gap: clamp(0.9rem, 2vw, 2rem);
}
.app-explorer-hero__stats div {
  flex-direction: row-reverse;
  gap: 0.35rem;
}
.app-explorer-hero__stats dt {
  font-size: 0.75rem;
}
.app-explorer-hero__stats dd {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
</style>

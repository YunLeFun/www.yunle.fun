<script setup lang="ts">
import type { ExplorerApp } from '~/types/app-explorer'
import { computed } from 'vue'
import { useSsoAccountState } from '~/composables/useSsoAccountState'
import { ssoExplorerApps } from '~/config/sso-explorer'
import AppSsoCloudMap from './AppSsoCloudMap.vue'

const props = defineProps<{
  apps: ExplorerApp[]
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
          YUNLE.FUN · APPLICATION ATLAS
        </p>
        <h1>云端应用图谱</h1>
        <p class="app-explorer-hero__lead">
          一个云乐坊账号，连接已接入统一登录的应用；继续向下，发现全部公开应用。
        </p>
      </div>

      <dl class="app-explorer-hero__stats" aria-label="应用图谱统计">
        <div>
          <dt>公开应用</dt>
          <dd>{{ apps.length }}</dd>
        </div>
        <div>
          <dt>创意分类</dt>
          <dd>{{ categoryCount }}</dd>
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
  gap: 1.5rem;
}

.app-explorer-hero__intro {
  display: grid;
  gap: 1.5rem;
  align-items: end;
}

.app-explorer-hero__eyebrow {
  color: var(--ylf-dopa-cyan);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.16em;
}

.app-explorer-hero h1 {
  margin-top: 0.45rem;
  font-size: clamp(2.35rem, 7vw, 5.25rem);
  font-weight: 900;
  letter-spacing: -0.055em;
  line-height: 0.98;
}

.app-explorer-hero__lead {
  max-width: 42rem;
  margin-top: 1rem;
  color: var(--ui-text-muted);
  font-size: clamp(1rem, 2vw, 1.15rem);
  line-height: 1.8;
}

.app-explorer-hero__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.6rem;
  margin: 0;
}

.app-explorer-hero__stats div {
  min-width: 0;
  border: 1px solid var(--ui-border);
  border-radius: 1rem;
  padding: 0.8rem;
  background: color-mix(in srgb, var(--ui-bg) 72%, transparent);
}

.app-explorer-hero__stats dt {
  color: var(--ui-text-muted);
  font-size: 0.68rem;
}

.app-explorer-hero__stats dd {
  margin: 0.1rem 0 0;
  font-size: 1.35rem;
  font-weight: 800;
}

@media (min-width: 768px) {
  .app-explorer-hero__intro {
    grid-template-columns: minmax(0, 1fr) minmax(18rem, 0.45fr);
  }
}
</style>

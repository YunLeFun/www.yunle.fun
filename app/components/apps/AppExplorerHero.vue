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
        <p class="app-explorer-hero__eyebrow ylf-glass ylf-hero-shadow">
          <Icon name="i-lucide-cloud-sun" aria-hidden="true" />
          云乐坊应用集合
        </p>
        <h1 class="ylf-hero-shadow">
          云端应用<span class="app-explorer-hero__accent">图谱</span>
        </h1>
        <p class="app-explorer-hero__lead ylf-hero-shadow">
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
          <dd><span :key="loading ? 'loading' : apps.length">{{ loading ? '—' : apps.length }}</span></dd>
        </div>
        <div>
          <dt>创意分类</dt>
          <dd><span :key="loading ? 'loading' : categoryCount">{{ loading ? '—' : categoryCount }}</span></dd>
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
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border-radius: 999px;
  padding: 0.35rem 0.8rem;
  color: #fff;
  font-size: 0.75rem;
  font-weight: 600;
  animation: explore-rise 900ms var(--ylf-ease-spring) backwards;
}

.app-explorer-hero__eyebrow :deep(svg) {
  width: 1rem;
  height: 1rem;
}

.app-explorer-hero h1 {
  margin-top: 1rem;
  color: #fff;
  /* 「图谱」不在站酷小薇子集内，整行改用圆体标题字，避免同一标题混排两种字体 */
  font-family: var(--ylf-font-heading);
  font-size: var(--ylf-type-display);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.15;
  animation: explore-rise 1000ms var(--ylf-ease-spring) 120ms backwards;
}

.app-explorer-hero__accent {
  position: relative;
  display: inline-block;
  background-image: linear-gradient(115deg, #fff1b8, #ffd4b0);
  background-clip: text;
  color: transparent;
  text-shadow: none;
}

/* 与首页「乐趣」一致的柔光下划线：标题落定后从左向右亮起。 */
.app-explorer-hero__accent::after {
  content: '';
  position: absolute;
  right: 0.06em;
  bottom: -0.04em;
  left: 0.06em;
  height: 0.1em;
  border-radius: 999px;
  background: linear-gradient(90deg, rgb(255 241 184 / 0%), #fff1b8 30%, #ffd4b0 70%, rgb(255 212 176 / 0%));
  transform-origin: 0 50%;
  animation: explore-underline 900ms var(--ylf-ease-spring) 900ms backwards;
}

.app-explorer-hero__lead {
  max-width: 42rem;
  margin-top: 0.85rem;
  color: rgb(255 255 255 / 90%);
  font-size: 0.95rem;
  line-height: 1.8;
  animation: explore-rise 1000ms var(--ylf-ease-spring) 240ms backwards;
}

.app-explorer-hero__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.6rem;
  margin: 0;
  animation: explore-rise 1000ms var(--ylf-ease-spring) 360ms backwards;
}

.app-explorer-hero__stats div {
  min-width: 0;
  border: 1px solid rgb(255 255 255 / 38%);
  border-radius: 1.1rem;
  padding: 0.75rem 0.9rem;
  /* 偏深的玻璃，压在白云上也能看清白色数字。 */
  background: rgb(16 52 104 / 24%);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 35%);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.app-explorer-hero__stats dt {
  color: rgb(255 255 255 / 85%);
  font-size: 0.7rem;
}

.app-explorer-hero__stats dd {
  margin: 0.3rem 0 0;
  color: #fff;
  font-size: 1.7rem;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 2px 10px rgb(15 50 100 / 35%);
}

/* 数字从占位变为结果时轻轻弹出。 */
.app-explorer-hero__stats dd span {
  display: inline-block;
  animation: explore-pop 600ms var(--ylf-ease-spring);
}

.dark .app-explorer-hero__stats div {
  border-color: rgb(255 225 215 / 22%);
  background: rgb(40 30 70 / 35%);
  box-shadow: inset 0 1px 0 rgb(255 225 215 / 18%);
}

@keyframes explore-rise {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
}

@keyframes explore-underline {
  from {
    transform: scaleX(0);
  }
}

@keyframes explore-pop {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.85);
  }
}

@media (min-width: 1024px) {
  .app-explorer-hero__intro {
    grid-template-columns: minmax(0, 1fr) minmax(20rem, 0.4fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .app-explorer-hero__eyebrow,
  .app-explorer-hero h1,
  .app-explorer-hero__accent::after,
  .app-explorer-hero__lead,
  .app-explorer-hero__stats,
  .app-explorer-hero__stats dd span {
    animation: none;
  }
}
</style>

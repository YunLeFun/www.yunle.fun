<script setup lang="ts">
import type { SsoAccountState, SsoExplorerApp } from '~/types/app-explorer'
import { computed, shallowRef } from 'vue'
import SsoAccountCloud from './SsoAccountCloud.vue'
import SsoAppCloud from './SsoAppCloud.vue'
import SsoCloudRoutes from './SsoCloudRoutes.vue'

const props = withDefaults(defineProps<{
  apps: SsoExplorerApp[]
  account: SsoAccountState
  reducedMotion?: boolean
}>(), { reducedMotion: false })

defineEmits<{ scrollToGrid: [] }>()

const activeAppId = shallowRef<string | null>(null)
const inspectedAppId = shallowRef<string | null>(null)
const inspectedApp = computed(() => props.apps.find(app => app.appId === inspectedAppId.value))
const positionedApps = computed(() => props.apps.map((app, index) => {
  const angle = index / props.apps.length * Math.PI * 2 - Math.PI / 2
  return {
    ...app,
    position: {
      x: 50 + 38 * Math.cos(angle),
      y: 50 + 37.5 * Math.sin(angle),
    },
  }
}))

function activate(appId: string) {
  activeAppId.value = appId
  inspectedAppId.value = appId
}

function deactivate(appId: string) {
  if (activeAppId.value === appId)
    activeAppId.value = null
}
</script>

<template>
  <section class="app-sso-cloud-map" aria-label="统一账号应用云图">
    <header class="app-sso-cloud-map__header">
      <div>
        <h2><Icon name="i-lucide-cloud" aria-hidden="true" /> 应用云图</h2>
        <p>{{ apps.length }} 个应用，共用一个云乐坊账号</p>
      </div>
      <span class="app-sso-cloud-map__legend"><span /> 已接入统一账号</span>
    </header>

    <div class="app-sso-cloud-map__content">
      <div class="app-sso-cloud-map__orbit" aria-hidden="true" />
      <SsoCloudRoutes
        :apps="positionedApps"
        :active-app-id="activeAppId"
        :reduced-motion="reducedMotion"
      />

      <div class="app-sso-cloud-map__account">
        <SsoAccountCloud :account="account" />
      </div>

      <div class="app-sso-cloud-map__apps" aria-label="支持统一账号的应用">
        <div
          v-for="app in positionedApps"
          :key="app.appId"
          class="app-sso-cloud-map__app"
          :style="{ left: `${app.position.x}%`, top: `${app.position.y}%` }"
        >
          <SsoAppCloud
            :app="app"
            :active="activeAppId === app.appId"
            @activate="activate"
            @deactivate="deactivate"
          />
        </div>
      </div>
    </div>

    <footer class="app-sso-cloud-map__footer">
      <div class="app-sso-cloud-map__hint">
        <div class="app-sso-cloud-map__hint-heading">
          <strong>{{ inspectedApp?.name || '每一朵云，都有新发现' }}</strong>
          <NuxtLink
            v-if="inspectedApp?.detailSlug"
            :to="`/apps/${inspectedApp.detailSlug}`"
            class="app-sso-cloud-map__detail"
            :aria-label="`查看 ${inspectedApp.name} 的站内详情`"
          >
            查看介绍 <Icon name="i-lucide-arrow-right" aria-hidden="true" />
          </NuxtLink>
        </div>
        <p>{{ inspectedApp?.description || '点击应用，打开你的下一段云端体验。' }}</p>
      </div>
      <AppButton
        class="app-sso-cloud-map__browse"
        label="浏览全部应用"
        icon="i-lucide-layout-grid"
        color="neutral"
        variant="outline"
        @click="$emit('scrollToGrid')"
      />
    </footer>
  </section>
</template>

<style scoped>
.app-sso-cloud-map {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border: 1px solid var(--ui-border-muted);
  border-radius: 1.75rem;
  background: color-mix(in srgb, var(--ui-primary) 3%, var(--ui-bg-muted));
  box-shadow: 0 20px 50px -35px color-mix(in srgb, var(--ylf-shadow-color) 18%, transparent);
}

.app-sso-cloud-map__header {
  position: relative;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.5rem 1.75rem 0;
}

.app-sso-cloud-map__header h2 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--ui-text-highlighted);
  font-size: 0.95rem;
  font-weight: 650;
}

.app-sso-cloud-map__header h2 :deep(svg) {
  width: 1.15rem;
  height: 1.15rem;
  color: var(--ui-primary);
}

.app-sso-cloud-map__header p {
  margin-top: 0.3rem;
  color: var(--ui-text-muted);
  font-size: 0.75rem;
}

.app-sso-cloud-map__legend {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--ui-text-muted);
  font-size: 0.7rem;
}

.app-sso-cloud-map__legend > span {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 50%;
  background: var(--ylf-dopa-green);
}

.app-sso-cloud-map__content {
  position: relative;
  height: 40rem;
  background:
    radial-gradient(ellipse at center, color-mix(in srgb, var(--ui-primary) 7%, transparent), transparent 58%),
    radial-gradient(circle, color-mix(in srgb, var(--ui-text-dimmed) 23%, transparent) 0.7px, transparent 0.8px);
  background-size:
    auto,
    20px 20px;
}

.app-sso-cloud-map__orbit {
  position: absolute;
  inset: 24% 30%;
  border: 1px dashed color-mix(in srgb, var(--ui-primary) 13%, transparent);
  border-radius: 50%;
  pointer-events: none;
}

.app-sso-cloud-map__account {
  position: absolute;
  z-index: 3;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}

.app-sso-cloud-map__apps {
  display: contents;
}

.app-sso-cloud-map__app {
  position: absolute;
  z-index: 3;
  transform: translate(-50%, -50%);
}

.app-sso-cloud-map__footer {
  position: relative;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  border-top: 1px solid var(--ui-border-muted);
  padding: 1rem 1.75rem;
  background: color-mix(in srgb, var(--ui-bg-elevated) 65%, transparent);
}

.app-sso-cloud-map__hint {
  display: grid;
  min-width: 0;
  gap: 0.2rem;
}

.app-sso-cloud-map__hint strong {
  color: var(--ui-text-highlighted);
  font-size: 0.8rem;
  font-weight: 600;
}

.app-sso-cloud-map__hint-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.9rem;
}

.app-sso-cloud-map__detail {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border-radius: 0.25rem;
  padding: 0.15rem 0;
  color: var(--ui-primary);
  font-size: 0.72rem;
  font-weight: 500;
  text-underline-offset: 0.2rem;
}

.app-sso-cloud-map__detail :deep(svg) {
  width: 0.8rem;
  height: 0.8rem;
}

.app-sso-cloud-map__detail:hover {
  text-decoration: underline;
}

.app-sso-cloud-map__detail:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 4px;
}

.app-sso-cloud-map__hint p {
  color: var(--ui-text-muted);
  font-size: 0.72rem;
  line-height: 1.5;
}

.app-sso-cloud-map__browse {
  flex: none;
}

@media (max-width: 767px) {
  .app-sso-cloud-map__content {
    display: grid;
    height: auto;
    justify-items: center;
    gap: 1.25rem;
    padding: 1rem 1.5rem 1.75rem;
  }

  .app-sso-cloud-map__orbit,
  .app-sso-cloud-map__content :deep(.sso-cloud-routes) {
    display: none;
  }

  .app-sso-cloud-map__account {
    position: relative;
    left: auto;
    top: auto;
    transform: none;
  }

  .app-sso-cloud-map__account::after {
    position: absolute;
    left: 50%;
    bottom: -1.25rem;
    width: 1px;
    height: 2.25rem;
    background: color-mix(in srgb, var(--ui-primary) 22%, transparent);
    content: '';
  }

  .app-sso-cloud-map__apps {
    position: relative;
    display: grid;
    width: 100%;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 1.1rem 0.75rem;
    border-top: 1px solid color-mix(in srgb, var(--ui-primary) 22%, transparent);
    padding-top: 1.25rem;
  }

  .app-sso-cloud-map__app {
    position: relative;
    left: auto !important;
    top: auto !important;
    width: 100%;
    transform: none;
  }

  .app-sso-cloud-map__app :deep(.sso-app-node) {
    width: 100%;
  }
}

@media (max-width: 639px) {
  .app-sso-cloud-map {
    border-radius: 1.35rem;
  }

  .app-sso-cloud-map__header {
    padding: 1.15rem 1.15rem 0;
  }

  .app-sso-cloud-map__legend {
    display: none;
  }

  .app-sso-cloud-map__content {
    gap: 0.75rem;
    padding: 0.5rem 0.85rem 1.25rem;
  }

  .app-sso-cloud-map__apps {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.65rem 0.25rem;
  }

  .app-sso-cloud-map__account::after {
    bottom: -0.75rem;
    height: 1.75rem;
  }

  .app-sso-cloud-map__footer {
    align-items: stretch;
    flex-direction: column;
    gap: 0.85rem;
    padding: 1rem 1.15rem;
  }

  .app-sso-cloud-map__browse {
    justify-content: center;
  }
}
</style>

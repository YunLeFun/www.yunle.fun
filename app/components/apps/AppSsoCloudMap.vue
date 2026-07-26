<script setup lang="ts">
import type { SsoAccountState, SsoExplorerApp } from '~/types/app-explorer'
import { shallowRef } from 'vue'
import SkyScene from '../SkyScene.vue'
import SsoAccountCloud from './SsoAccountCloud.vue'
import SsoAppCloud from './SsoAppCloud.vue'
import SsoCloudRoutes from './SsoCloudRoutes.vue'

withDefaults(defineProps<{
  apps: SsoExplorerApp[]
  account: SsoAccountState
  reducedMotion?: boolean
}>(), {
  reducedMotion: false,
})

defineEmits<{
  scrollToGrid: []
}>()

const activeAppId = shallowRef<string | null>(null)

function deactivate(appId: string) {
  if (activeAppId.value === appId)
    activeAppId.value = null
}
</script>

<template>
  <section
    class="app-sso-cloud-map"
    aria-label="统一账号应用云图"
  >
    <SkyScene clouds="mini" class="app-sso-cloud-map__sky" />
    <div class="app-sso-cloud-map__veil" aria-hidden="true" />

    <div class="app-sso-cloud-map__desktop">
      <SsoCloudRoutes
        :apps="apps"
        :active-app-id="activeAppId"
        :reduced-motion="reducedMotion"
      />

      <div class="app-sso-cloud-map__account">
        <SsoAccountCloud :account="account" surface="desktop" />
      </div>

      <div
        v-for="app in apps"
        :key="app.appId"
        class="app-sso-cloud-map__app"
        :style="{
          left: `${app.position.x}%`,
          top: `${app.position.y}%`,
        }"
      >
        <SsoAppCloud
          :app="app"
          :active="activeAppId === app.appId"
          @activate="activeAppId = $event"
          @deactivate="deactivate"
        />
      </div>
    </div>

    <div class="app-sso-cloud-map__mobile">
      <SsoAccountCloud :account="account" surface="mobile" />

      <div class="app-sso-cloud-map__mobile-route" aria-hidden="true">
        <span />
      </div>

      <div class="app-sso-cloud-map__rail" aria-label="支持统一账号的应用">
        <SsoAppCloud
          v-for="app in apps"
          :key="`mobile-${app.appId}`"
          :app="app"
          :active="activeAppId === app.appId"
          @activate="activeAppId = $event"
          @deactivate="deactivate"
        />
      </div>
    </div>

    <UButton
      class="app-sso-cloud-map__browse"
      label="浏览全部应用"
      icon="i-lucide-layout-grid"
      color="neutral"
      variant="solid"
      @click="$emit('scrollToGrid')"
    />
  </section>
</template>

<style scoped>
.app-sso-cloud-map {
  position: relative;
  isolation: isolate;
  min-height: 34rem;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--ylf-sso-cloud-top) 62%, transparent);
  border-radius: 1.75rem;
  background: var(--ylf-sso-sky);
  box-shadow:
    0 32px 85px -38px color-mix(in srgb, var(--ylf-dopa-blue) 58%, transparent),
    inset 0 1px color-mix(in srgb, var(--ylf-sso-cloud-top) 76%, transparent);
}

.app-sso-cloud-map__sky {
  z-index: 0;
}

.app-sso-cloud-map__veil {
  position: absolute;
  z-index: 1;
  background:
    radial-gradient(circle at 50% 58%, color-mix(in srgb, var(--ylf-sso-cloud-top) 20%, transparent), transparent 26%),
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--ylf-sso-veil-top) 4%, transparent),
      color-mix(in srgb, var(--ylf-sso-veil-bottom) 16%, transparent)
    );
  inset: 0;
  pointer-events: none;
}

.app-sso-cloud-map__desktop {
  position: absolute;
  z-index: 2;
  inset: 0;
}

.app-sso-cloud-map__account {
  position: absolute;
  z-index: 5;
  left: 50%;
  top: 59%;
  transform: translate(-50%, -50%);
}

.app-sso-cloud-map__app {
  position: absolute;
  z-index: 5;
  transform: translate(-50%, -50%);
}

.app-sso-cloud-map__mobile {
  display: none;
}

.app-sso-cloud-map__browse {
  position: absolute;
  z-index: 10;
  right: 1rem;
  bottom: 1rem;
}

@media (max-width: 1023px) {
  .app-sso-cloud-map {
    min-height: 32rem;
  }

  .app-sso-cloud-map__app {
    scale: 0.86;
  }

  .app-sso-cloud-map__account {
    scale: 0.9;
  }
}

@media (max-width: 767px) {
  .app-sso-cloud-map {
    min-height: 30rem;
    border-radius: 1.45rem;
  }

  .app-sso-cloud-map__desktop {
    display: none;
  }

  .app-sso-cloud-map__mobile {
    position: absolute;
    z-index: 4;
    display: grid;
    justify-items: center;
    padding-top: 1rem;
    inset: 0;
  }

  .app-sso-cloud-map__mobile-route {
    position: relative;
    width: 100%;
    height: 1.8rem;
  }

  .app-sso-cloud-map__mobile-route::before {
    position: absolute;
    width: 0.55rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ylf-sso-cloud-top) 72%, transparent);
    box-shadow: 0 0 12px color-mix(in srgb, var(--ylf-sso-route-cyan) 65%, transparent);
    content: '';
    inset: -0.6rem auto 0 50%;
    transform: translateX(-50%);
  }

  .app-sso-cloud-map__mobile-route span {
    position: absolute;
    height: 0.35rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ylf-sso-cloud-top) 68%, transparent);
    box-shadow: 0 0 10px color-mix(in srgb, var(--ylf-sso-route-cyan) 45%, transparent);
    inset: auto 1.5rem 0;
  }

  .app-sso-cloud-map__rail {
    display: flex;
    width: 100%;
    gap: 0.75rem;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    padding: 0 1rem 5.25rem;
    scroll-padding-inline: 1rem;
    scroll-snap-type: inline mandatory;
    scrollbar-width: none;
  }

  .app-sso-cloud-map__rail::-webkit-scrollbar {
    display: none;
  }

  .app-sso-cloud-map__rail :deep(.sso-app-node) {
    width: 15rem;
    flex: 0 0 15rem;
    scroll-snap-align: center;
  }

  .app-sso-cloud-map__browse {
    right: 1rem;
    bottom: 1rem;
    left: 1rem;
    justify-content: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .app-sso-cloud-map__account,
  .app-sso-cloud-map__app {
    transition: none;
  }
}
</style>

<script setup lang="ts">
import type { SsoExplorerApp } from '~/types/app-explorer'
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  apps: SsoExplorerApp[]
  activeAppId?: string | null
  reducedMotion?: boolean
}>(), {
  activeAppId: null,
  reducedMotion: false,
})

const gradientId = 'sso-cloud-route-gradient'
const activeApp = computed(() => props.apps.find(app => app.appId === props.activeAppId))

function routePath(app: SsoExplorerApp) {
  const left = app.position.x < 50
  const startX = left ? 42 : 58
  const startY = 58 + (app.position.y - 58) * 0.12
  const endX = app.position.x + (left ? 9 : -9)
  const endY = app.position.y + 1
  const controlX = left
    ? Math.min(startX - 8, (startX + endX) / 2)
    : Math.max(startX + 8, (startX + endX) / 2)
  const controlY = (startY + endY) / 2 + (app.position.y < 58 ? -2 : 2)

  return `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`
}
</script>

<template>
  <svg
    class="sso-cloud-routes"
    viewBox="0 0 100 100"
    preserveAspectRatio="none"
    aria-hidden="true"
    data-testid="sso-cloud-routes"
  >
    <defs>
      <linearGradient :id="gradientId" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="var(--ylf-sso-cloud-top)" stop-opacity="0" />
        <stop offset="0.42" stop-color="var(--ylf-sso-route-cyan)" stop-opacity="0.95" />
        <stop offset="0.72" stop-color="var(--ylf-sso-route-violet)" stop-opacity="0.9" />
        <stop offset="1" stop-color="var(--ylf-sso-cloud-top)" stop-opacity="0" />
      </linearGradient>
    </defs>

    <g v-for="app in apps" :key="app.appId">
      <path
        :d="routePath(app)"
        class="sso-cloud-routes__ribbon"
        vector-effect="non-scaling-stroke"
      />
      <path
        :d="routePath(app)"
        class="sso-cloud-routes__edge"
        vector-effect="non-scaling-stroke"
      />
    </g>

    <template v-if="activeApp">
      <path
        :d="routePath(activeApp)"
        class="sso-cloud-routes__active"
        vector-effect="non-scaling-stroke"
      />
      <path
        v-if="!reducedMotion"
        :key="activeApp.appId"
        :d="routePath(activeApp)"
        class="sso-cloud-routes__beam"
        :stroke="`url(#${gradientId})`"
        pathLength="1"
        vector-effect="non-scaling-stroke"
      />
    </template>
  </svg>
</template>

<style scoped>
.sso-cloud-routes {
  position: absolute;
  z-index: 2;
  width: 100%;
  height: 100%;
  inset: 0;
  pointer-events: none;
}

.sso-cloud-routes path {
  fill: none;
  stroke-linecap: round;
}

.sso-cloud-routes__ribbon {
  stroke: color-mix(in srgb, var(--ylf-sso-cloud-top) 45%, transparent);
  stroke-width: 7;
}

.sso-cloud-routes__edge {
  stroke: color-mix(in srgb, var(--ylf-sso-route-edge) 68%, transparent);
  stroke-width: 1.1;
}

.sso-cloud-routes__active {
  stroke: color-mix(in srgb, var(--ylf-sso-cloud-top) 82%, transparent);
  stroke-width: 8.5;
}

.sso-cloud-routes__beam {
  stroke-width: 3.2;
  stroke-dasharray: 0.18 0.82;
  animation: sso-cloud-beam 1.8s ease-out 1;
}

@keyframes sso-cloud-beam {
  from {
    stroke-dashoffset: 0.82;
  }

  to {
    stroke-dashoffset: -0.18;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sso-cloud-routes__beam {
    animation: none;
  }
}
</style>

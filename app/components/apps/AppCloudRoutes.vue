<script setup lang="ts">
import type { CloudRoute } from '~/utils/app-cloud-layout'
import { computed, useId } from 'vue'

const props = withDefaults(defineProps<{
  routes: CloudRoute[]
  reducedMotion?: boolean
}>(), {
  reducedMotion: false,
})

const gradientId = `cloud-route-${useId().replaceAll(':', '')}`
const animatedRoutes = computed(() => props.routes.filter(route => route.kind === 'core').slice(0, 4))

function routePath(route: CloudRoute) {
  const deltaX = route.end.x - route.start.x
  const deltaY = route.end.y - route.start.y
  const distance = Math.max(Math.hypot(deltaX, deltaY), 1)
  const bend = route.kind === 'core' ? 4 : 1.8
  const controlX = (route.start.x + route.end.x) / 2 - (deltaY / distance) * bend
  const controlY = (route.start.y + route.end.y) / 2 + (deltaX / distance) * bend

  return `M ${route.start.x} ${route.start.y} Q ${controlX} ${controlY} ${route.end.x} ${route.end.y}`
}
</script>

<template>
  <!-- Moving beam treatment adapted from Inspira UI Animated Beam (MIT): https://github.com/unovue/inspira-ui -->
  <svg
    data-testid="cloud-routes"
    class="app-cloud-routes"
    viewBox="0 0 100 100"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <defs>
      <linearGradient :id="gradientId" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="var(--ylf-dopa-cyan)" stop-opacity="0" />
        <stop offset="0.48" stop-color="var(--ylf-dopa-cyan)" stop-opacity="0.95" />
        <stop offset="1" stop-color="var(--ylf-dopa-violet)" stop-opacity="0" />
      </linearGradient>
    </defs>

    <path
      v-for="route in routes"
      :key="route.id"
      :d="routePath(route)"
      class="app-cloud-routes__path"
      :class="`app-cloud-routes__path--${route.kind}`"
      vector-effect="non-scaling-stroke"
    />

    <path
      v-for="(route, index) in reducedMotion ? [] : animatedRoutes"
      :key="`beam-${route.id}`"
      :d="routePath(route)"
      class="app-cloud-routes__beam"
      :style="{ animationDelay: `${index * -0.9}s` }"
      :stroke="`url(#${gradientId})`"
      pathLength="1"
      vector-effect="non-scaling-stroke"
    />
  </svg>
</template>

<style scoped>
.app-cloud-routes {
  position: absolute;
  z-index: 2;
  width: 100%;
  height: 100%;
  inset: 0;
  pointer-events: none;
}

.app-cloud-routes__path {
  fill: none;
  stroke: rgba(255, 255, 255, 0.4);
  stroke-linecap: round;
}

.app-cloud-routes__path--core {
  stroke-width: 1.25;
  stroke-dasharray: 4 5;
}

.app-cloud-routes__path--group {
  stroke-width: 0.8;
  stroke-dasharray: 2 4;
  stroke-opacity: 0.56;
}

.app-cloud-routes__beam {
  fill: none;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-dasharray: 0.16 0.84;
  animation: app-cloud-beam 4.4s linear infinite;
}

@keyframes app-cloud-beam {
  to {
    stroke-dashoffset: -1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .app-cloud-routes__beam {
    animation: none;
  }
}
</style>

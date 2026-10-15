<script setup lang="ts">
import type { SsoExplorerApp } from '~/types/app-explorer'
import AppProductIcon from '~/components/apps/AppProductIcon.vue'

defineProps<{
  apps: SsoExplorerApp[]
}>()
</script>

<template>
  <!-- 一条安静漂过的云路：应用名像远处的云一样缓缓经过。
       只做装饰，应用的可访问列表在下方画廊中。 -->
  <div class="home-marquee" aria-hidden="true">
    <p class="home-marquee__verse">
      云之彼端，总有新的应用在等你
    </p>
    <div class="home-marquee__stream">
      <div class="home-marquee__track">
        <template v-for="copy in 2" :key="copy">
          <span v-for="app in apps" :key="`${copy}-${app.appId}`" class="home-marquee__app">
            <AppProductIcon :app="app" class="home-marquee__icon" />
            {{ app.name }}
            <svg class="home-marquee__cloud" viewBox="0 0 24 12" fill="currentColor">
              <path d="M5 12a4 4 0 0 1-.6-7.95A5 5 0 0 1 13.6 2.6 3.6 3.6 0 0 1 19.4 5 3.5 3.5 0 0 1 19.5 12Z" />
            </svg>
          </span>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.home-marquee {
  display: grid;
  gap: 0.9rem;
  margin-bottom: clamp(2rem, 5vw, 3.5rem);
  text-align: center;
}

.home-marquee__verse {
  color: var(--ui-text-muted);
  font-family: var(--ylf-font-dreamy);
  font-size: clamp(0.95rem, 1.6vw, 1.15rem);
  letter-spacing: 0.32em;
}

/* 两端渐隐，让文字像从天边飘进来、再飘出去。 */
.home-marquee__stream {
  overflow: hidden;
  padding-block: 0.4rem;
  mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent);
}

.home-marquee__track {
  display: flex;
  width: max-content;
  animation: home-marquee 90s linear infinite;
}

.home-marquee__stream:hover .home-marquee__track {
  animation-play-state: paused;
}

.home-marquee__app {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 0.55rem;
  padding-inline: 1.1rem;
  color: color-mix(in srgb, var(--ui-text) 72%, transparent);
  font-family: var(--ylf-font-dreamy);
  font-size: 1.05rem;
  white-space: nowrap;
  transition: color var(--ylf-duration-fast) var(--ylf-ease-standard);
}

.home-marquee__app:hover {
  color: var(--ui-text-highlighted);
}

.home-marquee__icon {
  --app-icon-size: 1.5rem;
  font-size: 0.6rem;
  opacity: 0.9;
}

.home-marquee__cloud {
  width: 1.1rem;
  height: 0.55rem;
  margin-left: 1.1rem;
  color: color-mix(in srgb, var(--ui-primary) 35%, transparent);
}

@keyframes home-marquee {
  to {
    transform: translateX(-50%);
  }
}

@media (max-width: 767px) {
  .home-marquee__verse {
    letter-spacing: 0.18em;
  }

  .home-marquee__app {
    font-size: 0.95rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .home-marquee__track {
    animation: none;
  }
}
</style>

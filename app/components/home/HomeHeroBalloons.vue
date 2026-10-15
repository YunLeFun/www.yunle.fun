<script setup lang="ts">
import { appIcons } from '~/config/app-icons'

interface Balloon {
  appId: string
  name: string
  href: string
}

defineProps<{
  balloons: readonly Balloon[]
}>()

// 每只气球有自己的位置、深度与摆动节奏，避免整齐划一地上下跳。
const layout = [
  { x: 57, y: 12, depth: 0.55, duration: 6.4, delay: -1.2, size: 3.6 },
  { x: 75, y: 8, depth: 0.35, duration: 7.2, delay: -3.4, size: 3 },
  { x: 91, y: 22, depth: 0.5, duration: 5.8, delay: -0.4, size: 3.3 },
  { x: 67, y: 58, depth: 0.9, duration: 6.8, delay: -2.6, size: 3.9 },
  { x: 55, y: 44, depth: 0.7, duration: 7.6, delay: -4.8, size: 3.2 },
]
</script>

<template>
  <ul class="home-hero-balloons" aria-label="漂在云上的应用">
    <li
      v-for="(balloon, index) in balloons.slice(0, layout.length)"
      :key="balloon.appId"
      class="home-hero-balloons__item"
      :style="{
        '--x': `${layout[index]!.x}%`,
        '--y': `${layout[index]!.y}%`,
        '--depth': layout[index]!.depth,
        '--bob-duration': `${layout[index]!.duration}s`,
        '--bob-delay': `${layout[index]!.delay}s`,
        '--size': `${layout[index]!.size}rem`,
        '--enter-delay': `${700 + index * 110}ms`,
      }"
    >
      <a
        :href="balloon.href"
        target="_blank"
        rel="noopener noreferrer"
        class="home-hero-balloons__link"
      >
        <span class="home-hero-balloons__bubble">
          <img :src="appIcons[balloon.appId]" alt="" width="48" height="48">
        </span>
        <svg class="home-hero-balloons__string" viewBox="0 0 12 44" fill="none" aria-hidden="true">
          <path d="M6 0 C 1 11, 11 22, 6 32 S 3 40, 6 44" stroke-width="1.3" stroke-linecap="round" />
        </svg>
        <span class="home-hero-balloons__label">
          {{ balloon.name }}
          <Icon name="i-lucide-arrow-up-right" aria-hidden="true" />
        </span>
        <span class="sr-only">，在新标签页打开</span>
      </a>
    </li>
  </ul>
</template>

<style scoped>
.home-hero-balloons {
  position: absolute;
  inset: 0;
  z-index: 3;
  margin: 0;
  padding: 0;
  list-style: none;
  pointer-events: none;
}

.home-hero-balloons__item {
  position: absolute;
  top: var(--y);
  left: var(--x);
  translate: calc(var(--px, 0) * var(--depth) * 30px)
    calc(var(--py, 0) * var(--depth) * 18px + var(--scroll, 0) * var(--depth) * -0.5px);
  transition: translate 1000ms var(--ylf-ease-standard);
  animation: home-balloon-enter 1300ms var(--ylf-ease-spring) var(--enter-delay) backwards;
}

.home-hero-balloons__link {
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: auto;
  transform-origin: 50% 100%;
  animation: home-balloon-bob var(--bob-duration) ease-in-out var(--bob-delay) infinite;
  -webkit-tap-highlight-color: transparent;
}

.home-hero-balloons__bubble {
  position: relative;
  display: grid;
  width: var(--size);
  height: var(--size);
  place-items: center;
  border: 1px solid rgb(255 255 255 / 72%);
  border-radius: 50% 50% 48% 48% / 54% 54% 46% 46%;
  background: radial-gradient(circle at 30% 24%, rgb(255 255 255 / 92%), transparent 34%), rgb(255 255 255 / 38%);
  box-shadow:
    inset 0 -6px 12px rgb(110 160 220 / 22%),
    0 14px 24px -14px rgb(18 60 120 / 55%);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  transition:
    transform var(--ylf-duration-slow) var(--ylf-ease-spring),
    box-shadow var(--ylf-duration-fast) var(--ylf-ease-standard);
}

.home-hero-balloons__bubble img {
  width: 66%;
  height: 66%;
  border-radius: 24%;
  pointer-events: none;
}

.home-hero-balloons__string {
  width: 0.75rem;
  height: 2.6rem;
  margin-top: -2px;
  stroke: rgb(255 255 255 / 70%);
}

.home-hero-balloons__label {
  position: absolute;
  top: calc(100% - 1.6rem);
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.3rem 0.65rem;
  border-radius: 999px;
  background: rgb(255 255 255 / 92%);
  box-shadow: 0 8px 18px -10px rgb(16 50 100 / 50%);
  color: #183257;
  font-size: 0.75rem;
  font-weight: 650;
  white-space: nowrap;
  opacity: 0;
  transform: translateY(-6px) scale(0.85);
  transition:
    opacity var(--ylf-duration-fast) var(--ylf-ease-standard),
    transform var(--ylf-duration-slow) var(--ylf-ease-spring);
}

.home-hero-balloons__label :deep(svg) {
  width: 0.8rem;
  height: 0.8rem;
}

.home-hero-balloons__link:hover .home-hero-balloons__bubble,
.home-hero-balloons__link:focus-visible .home-hero-balloons__bubble {
  transform: scale(1.16) rotate(-4deg);
  box-shadow:
    inset 0 -6px 12px rgb(110 160 220 / 22%),
    0 18px 30px -14px rgb(18 60 120 / 65%);
}

.home-hero-balloons__link:hover .home-hero-balloons__label,
.home-hero-balloons__link:focus-visible .home-hero-balloons__label {
  opacity: 1;
  transform: none;
}

.home-hero-balloons__link:hover {
  animation-play-state: paused;
}

.home-hero-balloons__link:focus-visible {
  outline: none;
}

.home-hero-balloons__link:focus-visible .home-hero-balloons__bubble {
  outline: 2px solid #fff;
  outline-offset: 3px;
}

.dark .home-hero-balloons__bubble {
  border-color: rgb(255 230 225 / 42%);
  background: radial-gradient(circle at 30% 24%, rgb(255 240 235 / 60%), transparent 34%), rgb(255 220 230 / 18%);
  box-shadow:
    inset 0 -6px 12px rgb(80 50 120 / 25%),
    0 14px 24px -14px rgb(30 15 60 / 65%);
}

.dark .home-hero-balloons__string {
  stroke: rgb(255 230 225 / 50%);
}

.dark .home-hero-balloons__label {
  background: rgb(40 30 70 / 90%);
  color: #ffeadf;
}

@keyframes home-balloon-bob {
  0%,
  100% {
    transform: translateY(0) rotate(-3deg);
  }
  50% {
    transform: translateY(-12px) rotate(3deg);
  }
}

@keyframes home-balloon-enter {
  from {
    opacity: 0;
    transform: translateY(120px) scale(0.6);
  }
}

@media (max-width: 1023px) {
  .home-hero-balloons {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .home-hero-balloons__item,
  .home-hero-balloons__link {
    animation: none;
  }

  .home-hero-balloons__bubble,
  .home-hero-balloons__label {
    transition: none;
  }
}
</style>

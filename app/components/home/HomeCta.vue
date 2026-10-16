<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import YlfCloud from '@yunlefun/vue/components/YlfCloud.vue'
import { vReveal } from '~/composables/useReveal'
import { useSkyParallax } from '~/composables/useSkyParallax'

interface CtaLink {
  icon?: string
  label: string
  to: RouteLocationRaw
  trailingIcon?: string
  variant?: 'solid' | 'outline'
}

defineProps<{
  title: string
  description?: string
  links?: CtaLink[]
}>()

const panel = shallowRef<HTMLElement | null>(null)
useSkyParallax(panel)

// 装饰云只负责层次；带小脸的两朵可以戳，戳一下会下一阵彩色小雨。
const decorClouds = [
  { name: 'far', shape: 'wisp', depth: 0.3, haze: 0.55 },
  { name: 'base', shape: 'bank', depth: 1, haze: 0.05 },
] as const
const pokeClouds = [
  { name: 'puff', shape: 'puff', depth: 0.7, haze: 0.1 },
  { name: 'drifter', shape: 'billow', depth: 0.5, haze: 0.22 },
] as const
const rainColors = [
  'var(--ylf-palette-blue)',
  'var(--ylf-palette-cyan)',
  'var(--ylf-palette-green)',
  'var(--ylf-palette-sun)',
  'var(--ylf-palette-coral)',
  'var(--ylf-palette-pink)',
]

interface Drop {
  id: number
  x: number
  y: number
  fall: number
  delay: number
  color: string
}

interface Rainbow {
  id: number
  x: number
  y: number
  size: number
}

const squished = shallowRef<string | null>(null)
const drops = shallowRef<Drop[]>([])
const rainbows = shallowRef<Rainbow[]>([])
const pokeCount = shallowRef(0)
let seed = 0

function pokeCloud(name: string, event: MouseEvent) {
  const box = panel.value?.getBoundingClientRect()
  const cloud = (event.currentTarget as HTMLElement).getBoundingClientRect()
  pokeCount.value++

  squished.value = null
  requestAnimationFrame(() => {
    squished.value = name
  })

  if (!box)
    return

  // 雨滴从云底中段落下，位置相对整张卡片计算。
  const left = cloud.left - box.left + cloud.width * 0.22
  const span = cloud.width * 0.56
  const bottom = cloud.top - box.top + cloud.height * 0.78
  const batch = Array.from({ length: 9 }, (_, index): Drop => ({
    id: ++seed,
    x: left + (span * (index + Math.random() * 0.6)) / 9,
    y: bottom,
    fall: 70 + Math.random() * 60,
    delay: Math.round(Math.random() * 260),
    color: rainColors[index % rainColors.length]!,
  }))
  drops.value = [...drops.value, ...batch]
  const ids = new Set(batch.map(drop => drop.id))
  setTimeout(() => {
    drops.value = drops.value.filter(drop => !ids.has(drop.id))
  }, 1300)

  // 每下第三阵雨，云边挂出一道小彩虹。
  if (pokeCount.value % 3 === 0) {
    const rainbow = { id: ++seed, x: cloud.left - box.left + cloud.width / 2, y: bottom, size: cloud.width * 0.9 }
    rainbows.value = [...rainbows.value, rainbow]
    setTimeout(() => {
      rainbows.value = rainbows.value.filter(item => item.id !== rainbow.id)
    }, 2400)
  }
}

const wobbling = shallowRef(new Set<string>())

function wobble(name: string) {
  const next = new Set(wobbling.value)
  next.delete(name)
  wobbling.value = next
  requestAnimationFrame(() => {
    wobbling.value = new Set(wobbling.value).add(name)
  })
}

function settle(name: string) {
  const next = new Set(wobbling.value)
  next.delete(name)
  wobbling.value = next
}

// 按钮被鼠标轻轻吸住，离开时弹回原位。
function attract(event: PointerEvent) {
  if (event.pointerType !== 'mouse')
    return
  const el = event.currentTarget as HTMLElement
  const box = el.getBoundingClientRect()
  el.style.setProperty('--mx', `${((event.clientX - box.left) / box.width - 0.5) * 12}px`)
  el.style.setProperty('--my', `${((event.clientY - box.top) / box.height - 0.5) * 10}px`)
}

function release(event: PointerEvent) {
  const el = event.currentTarget as HTMLElement
  el.style.setProperty('--mx', '0px')
  el.style.setProperty('--my', '0px')
}
</script>

<template>
  <section ref="panel" v-reveal class="home-cta">
    <!-- 太阳藏在右上角那朵云后面，光束从云隙里漏下来。 -->
    <SkyScene clouds="none" sun sun-x="84%" sun-y="20%" />
    <span class="home-cta__atmosphere" aria-hidden="true" />
    <!-- 装饰云同样是软的：只响应指针，点一下 Q 弹，不进入键盘焦点顺序。 -->
    <span
      v-for="cloud in decorClouds"
      :key="cloud.name"
      class="home-cta__decor"
      :class="`home-cta__decor--${cloud.name}`"
      :style="{ '--depth': cloud.depth, '--ylf-cloud-haze': cloud.haze }"
      aria-hidden="true"
      @click="wobble(cloud.name)"
    >
      <YlfCloud
        :shape="cloud.shape"
        :class="{ 'ylf-squish': wobbling.has(cloud.name) }"
        @animationend="settle(cloud.name)"
      />
    </span>
    <button
      v-for="cloud in pokeClouds"
      :key="cloud.name"
      type="button"
      class="home-cta__cloud"
      :class="`home-cta__cloud--${cloud.name}`"
      :style="{ '--depth': cloud.depth, '--ylf-cloud-haze': cloud.haze }"
      aria-label="戳一下云朵，下一阵彩色小雨"
      @click="pokeCloud(cloud.name, $event)"
    >
      <span class="home-cta__cloud-target" aria-hidden="true" />
      <YlfCloud
        :shape="cloud.shape"
        face
        class="home-cta__cloud-art"
        :class="{ 'is-squished': squished === cloud.name }"
        @animationend="squished = null"
      />
    </button>
    <span
      v-for="rainbow in rainbows"
      :key="rainbow.id"
      class="home-cta__rainbow"
      :style="{ left: `${rainbow.x}px`, top: `${rainbow.y}px`, width: `${rainbow.size}px` }"
      aria-hidden="true"
    />
    <span
      v-for="drop in drops"
      :key="drop.id"
      class="home-cta__drop"
      :style="{
        'left': `${drop.x}px`,
        'top': `${drop.y}px`,
        '--fall': `${drop.fall}px`,
        '--drop': drop.color,
        'animationDelay': `${drop.delay}ms`,
      }"
      aria-hidden="true"
    />
    <!-- 黄昏时分的几颗早星。 -->
    <span class="home-cta__stars" aria-hidden="true" />

    <div class="home-cta__content">
      <h2 class="ylf-hero-shadow">
        {{ title }}
      </h2>
      <p v-if="description" class="ylf-hero-shadow">
        {{ description }}
      </p>
      <div v-if="links?.length" class="home-cta__actions">
        <span
          v-for="(link, index) in links"
          :key="String(link.to)"
          class="home-cta__magnet"
          @pointermove="attract"
          @pointerleave="release"
        >
          <AppButton
            :to="link.to"
            :label="link.label"
            :icon="link.icon"
            :trailing-icon="link.trailingIcon"
            size="lg"
            :variant="index === 0 ? 'hero' : 'outline'"
            :color="index === 0 ? 'primary' : 'neutral'"
            class="rounded-[var(--ylf-radius)] font-semibold"
            :class="{ 'ylf-glass-btn': index > 0 }"
          />
        </span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-cta {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  margin-top: 1rem;
  border-radius: 2.5rem;
  padding: clamp(3.5rem, 8vw, 5.5rem) clamp(1.25rem, 5vw, 3rem);
  text-align: center;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 35%);
}

/* 云隙里漏下的光只做氛围，压低亮度，不抢文字。 */
.home-cta :deep(.ylf-ray) {
  opacity: 0.3;
  animation: none;
}

/* 文字背后压一层柔和的深蓝，保证白字在明亮天空上可读。 */
.home-cta__atmosphere {
  position: absolute;
  z-index: 1;
  inset: 0;
  background: radial-gradient(ellipse 60% 55% at 50% 48%, rgb(15 55 114 / 34%), transparent 75%);
}

.dark .home-cta__atmosphere {
  background: radial-gradient(ellipse 60% 55% at 50% 48%, rgb(24 22 65 / 45%), transparent 75%);
}

.home-cta__stars {
  position: absolute;
  z-index: 1;
  inset: 0 0 45%;
  opacity: 0;
  background:
    radial-gradient(1.5px 1.5px at 18% 22%, #fff4e8, transparent),
    radial-gradient(1px 1px at 31% 12%, #fff4e8, transparent),
    radial-gradient(1.5px 1.5px at 58% 9%, #fff4e8, transparent),
    radial-gradient(1px 1px at 72% 30%, #fff4e8, transparent),
    radial-gradient(1px 1px at 88% 42%, #fff4e8, transparent),
    radial-gradient(1.5px 1.5px at 44% 34%, #fff4e8, transparent);
  transition: opacity var(--ylf-duration-slow) var(--ylf-ease-standard);
}

.dark .home-cta__stars {
  opacity: 0.85;
}

/* ---- clouds ---- */
.home-cta__decor,
.home-cta__cloud {
  position: absolute;
  z-index: 1;
  translate: calc(var(--px, 0) * var(--depth) * 20px) calc(var(--py, 0) * var(--depth) * 12px);
  transition: translate 1000ms var(--ylf-ease-standard);
}

.home-cta__decor {
  cursor: pointer;
}

.home-cta__decor > :deep(svg) {
  display: block;
}

.home-cta__decor--far {
  top: 15%;
  left: 5%;
  width: clamp(140px, 16vw, 230px);
  filter: blur(1.2px);
  opacity: 0.75;
}

.home-cta__decor--base {
  bottom: -18%;
  left: -4%;
  width: clamp(260px, 32vw, 420px);
  opacity: 0.92;
}

.home-cta__cloud {
  z-index: 2;
  padding: 0;
  border: 0;
  background: none;
  pointer-events: none;
  animation: home-cta-drift 9s ease-in-out infinite alternate;
  -webkit-tap-highlight-color: transparent;
}

.home-cta__cloud--puff {
  top: 8%;
  right: 3%;
  width: clamp(160px, 18vw, 240px);
}

.home-cta__cloud--drifter {
  top: 46%;
  left: 2%;
  width: clamp(130px, 14vw, 190px);
  animation-delay: -4s;
  animation-duration: 11s;
}

/* 只让云朵本体可点。 */
.home-cta__cloud-target {
  position: absolute;
  z-index: 1;
  inset: 22% 14% 14%;
  border-radius: 48%;
  pointer-events: auto;
  cursor: pointer;
}

.home-cta__cloud:focus-visible {
  outline: none;
}

.home-cta__cloud:focus-visible .home-cta__cloud-target {
  outline: 2px solid #fff;
  outline-offset: 4px;
}

.home-cta__cloud-art {
  transform-origin: 50% 85%;
  filter: drop-shadow(0 10px 12px rgb(30 80 150 / 22%));
}

.dark .home-cta__cloud-art {
  filter: drop-shadow(0 10px 12px rgb(30 15 60 / 40%));
}

.home-cta__cloud:hover .home-cta__cloud-art,
.home-cta__cloud:focus-visible .home-cta__cloud-art,
.home-cta__cloud-art.is-squished {
  --ylf-cloud-face-opacity: 0.85;
}

.home-cta__cloud-art.is-squished {
  animation: home-cta-squish 640ms var(--ylf-ease-standard);
}

.home-cta__drop {
  position: absolute;
  z-index: 2;
  width: 6px;
  height: 10px;
  margin-left: -3px;
  border-radius: 50% 50% 50% 50% / 62% 62% 38% 38%;
  background: var(--drop);
  opacity: 0;
  animation: home-cta-rain 900ms cubic-bezier(0.5, 0, 0.9, 0.6) backwards;
}

.home-cta__rainbow {
  position: absolute;
  z-index: 0;
  aspect-ratio: 2;
  overflow: hidden;
  translate: -50% -78%;
  background: radial-gradient(
    50% 100% at 50% 100%,
    transparent 54%,
    var(--ylf-palette-pink) 54% 61%,
    var(--ylf-palette-coral) 61% 68%,
    var(--ylf-palette-sun) 68% 75%,
    var(--ylf-palette-green) 75% 82%,
    var(--ylf-palette-cyan) 82% 89%,
    var(--ylf-palette-blue) 89% 96%,
    transparent 96%
  );
  opacity: 0.7;
  mask-image: linear-gradient(to top, transparent, #000 45%);
  animation: home-cta-rainbow 2400ms var(--ylf-ease-standard) forwards;
}

.home-cta__content {
  position: relative;
  z-index: 3;
  display: flex;
  max-width: 40rem;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  margin-inline: auto;
}

.home-cta__content h2 {
  color: #fff;
  font-family: var(--ylf-font-dreamy);
  font-size: clamp(1.9rem, 4.5vw, 3rem);
  line-height: 1.25;
  text-wrap: balance;
}

.home-cta__content p {
  max-width: 32rem;
  color: rgb(255 255 255 / 92%);
  font-size: 0.95rem;
  line-height: 1.8;
}

.home-cta__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.75rem;
  margin-top: 0.75rem;
}

.home-cta__magnet {
  display: inline-flex;
  translate: var(--mx, 0) var(--my, 0);
  transition: translate var(--ylf-duration-slow) var(--ylf-ease-spring);
}

@keyframes home-cta-drift {
  from {
    transform: translateX(-8px);
  }
  to {
    transform: translateX(10px);
  }
}

@keyframes home-cta-squish {
  18% {
    transform: scale(1.08, 0.86);
  }
  42% {
    transform: scale(0.95, 1.07) translateY(-8px);
  }
  66% {
    transform: scale(1.02, 0.98);
  }
}

@keyframes home-cta-rain {
  0% {
    opacity: 0;
    transform: translateY(0) scale(0.6);
  }
  15% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translateY(var(--fall)) scale(1);
  }
}

@keyframes home-cta-rainbow {
  0% {
    opacity: 0;
    clip-path: inset(0 100% 0 0);
  }
  30% {
    opacity: 0.7;
    clip-path: inset(0 0 0 0);
  }
  75% {
    opacity: 0.7;
  }
  100% {
    opacity: 0;
  }
}

/* 窄屏标题占满整行，小形状退到上下边缘，不压住文字。 */
@media (max-width: 639px) {
  .home-cta__cloud--puff {
    top: 1%;
    right: -6%;
    width: 120px;
  }

  .home-cta__cloud--drifter,
  .home-cta__decor--far {
    display: none;
  }

  .home-cta__decor--base {
    bottom: -10%;
    width: 240px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .home-cta__cloud,
  .home-cta__cloud-art.is-squished {
    animation: none;
  }

  .home-cta__drop,
  .home-cta__rainbow {
    display: none;
  }

  .home-cta__magnet,
  .home-cta__decor,
  .home-cta__cloud {
    transition: none;
  }
}
</style>

<script setup lang="ts">
import type { YlfCloudShape } from '@yunlefun/vue'
import YlfCloud from '@yunlefun/vue/components/YlfCloud.vue'
import { useSkyParallax } from '~/composables/useSkyParallax'

/**
 * 晴空 Hero —— 圆角晴空背景区块（天空 + 文案侧压暗 + 可戳的云 + 内容层）。
 *
 * 会员权益页、个人中心、设置等页面的统一头图。内容通过默认插槽传入，
 * 自行控制内边距与栅格；组件负责晴空背景、scrim、云朵、圆角与层叠。
 * 自动跟随站点明暗模式（浅色白日 / 深色黄昏）。
 *
 * 云朵画在压暗层之上，保持干净的白；它们只响应指针：悬停时探出小脸，
 * 戳一下会 Q 弹、下一阵彩色小雨，每第三下挂出一道彩虹。键盘焦点只落在插槽里的控件上。
 */
const props = withDefaults(defineProps<{
  /** 是否在文案侧叠加压暗层（白字 hero 建议开启） */
  scrim?: boolean
  /** 云量：大头图用 full，窄横幅用 mini */
  clouds?: 'full' | 'mini' | 'none'
}>(), {
  scrim: true,
  clouds: 'full',
})

interface HeroCloud {
  name: string
  shape: YlfCloudShape
  /** 视差深度：越靠前，随鼠标移动越多 */
  depth: number
  /** 空气透视：越远越接近天空色 */
  haze: number
  face?: boolean
}

const LAYOUTS: Record<'full' | 'mini' | 'none', HeroCloud[]> = {
  full: [
    { name: 'far', shape: 'wisp', depth: 0.25, haze: 0.5 },
    { name: 'bank', shape: 'bank', depth: 0.55, haze: 0.14 },
    { name: 'billow', shape: 'billow', depth: 0.8, haze: 0.06, face: true },
    { name: 'puff', shape: 'puff', depth: 1.1, haze: 0, face: true },
  ],
  mini: [
    { name: 'far', shape: 'wisp', depth: 0.25, haze: 0.5 },
    { name: 'bank', shape: 'bank', depth: 0.55, haze: 0.16 },
    { name: 'puff', shape: 'puff', depth: 1, haze: 0, face: true },
  ],
  none: [],
}

const cloudList = computed(() => LAYOUTS[props.clouds])

const root = shallowRef<HTMLElement | null>(null)
useSkyParallax(root)

const reducedMotion = usePreferredReducedMotion()

const POKE_LINES = [
  '软的，真的是软的。',
  '嘿，好痒～',
  '再戳要下雨啦！',
  '送你一道彩虹 🌈',
  '云朵也需要休息的…',
]
const RAIN_COLORS = [
  'var(--ylf-palette-blue)',
  'var(--ylf-palette-cyan)',
  'var(--ylf-palette-green)',
  'var(--ylf-palette-sun)',
  'var(--ylf-palette-coral)',
  'var(--ylf-palette-pink)',
]

interface Drop { id: number, x: number, y: number, fall: number, delay: number, color: string }
interface Rainbow { id: number, x: number, y: number, size: number }
interface Bubble { id: number, x: number, y: number, text: string }

const squished = shallowRef<string | null>(null)
const drops = shallowRef<Drop[]>([])
const rainbows = shallowRef<Rainbow[]>([])
const bubble = shallowRef<Bubble | null>(null)
let pokes = 0
let seed = 0
const timers = new Set<ReturnType<typeof setTimeout>>()

function later(fn: () => void, ms: number) {
  const timer = setTimeout(() => {
    timers.delete(timer)
    fn()
  }, ms)
  timers.add(timer)
}

onBeforeUnmount(() => {
  timers.forEach(clearTimeout)
  timers.clear()
})

function poke(cloud: HeroCloud, event: MouseEvent) {
  pokes++
  squished.value = null
  requestAnimationFrame(() => {
    squished.value = cloud.name
  })

  const box = root.value?.getBoundingClientRect()
  const art = (event.currentTarget as HTMLElement).getBoundingClientRect()
  if (!box)
    return

  const centerX = art.left - box.left + art.width / 2
  const bottom = art.top - box.top + art.height * 0.8

  // 有小脸的云会说话
  if (cloud.face) {
    const text = POKE_LINES[(pokes - 1) % POKE_LINES.length]!
    const id = ++seed
    // 气泡按字数估算半宽，夹在横幅内，靠边的云也不会把话说到框外
    const half = text.length * 6.5 + 14
    const x = Math.min(Math.max(centerX, half + 8), box.width - half - 8)
    bubble.value = { id, x, y: Math.max(art.top - box.top + art.height * 0.3, 40), text }
    later(() => {
      if (bubble.value?.id === id)
        bubble.value = null
    }, 1800)
  }

  if (reducedMotion.value === 'reduce')
    return

  // 雨滴从云底中段落下
  const left = art.left - box.left + art.width * 0.24
  const span = art.width * 0.52
  const batch = Array.from({ length: 8 }, (_, index): Drop => ({
    id: ++seed,
    x: left + (span * (index + Math.random() * 0.6)) / 8,
    y: bottom,
    fall: 50 + Math.random() * 50,
    delay: Math.round(Math.random() * 240),
    color: RAIN_COLORS[index % RAIN_COLORS.length]!,
  }))
  drops.value = [...drops.value, ...batch]
  const ids = new Set(batch.map(drop => drop.id))
  later(() => {
    drops.value = drops.value.filter(drop => !ids.has(drop.id))
  }, 1300)

  if (pokes % 3 === 0) {
    const rainbow = { id: ++seed, x: centerX, y: bottom, size: art.width * 0.85 }
    rainbows.value = [...rainbows.value, rainbow]
    later(() => {
      rainbows.value = rainbows.value.filter(item => item.id !== rainbow.id)
    }, 2400)
  }
}
</script>

<template>
  <section
    ref="root"
    class="ylf-sky-hero relative isolate overflow-hidden rounded-[1.75rem] sm:rounded-[2rem]"
    :data-clouds="clouds"
  >
    <SkyScene :sun="false" clouds="none" class="pointer-events-none" />
    <span class="ylf-sky-hero__stars pointer-events-none" aria-hidden="true" />
    <div v-if="scrim" class="ylf-sky-hero__scrim pointer-events-none absolute inset-0 z-[1]" />

    <!-- 可戳的云：位于压暗层之上、内容之下 -->
    <span
      v-for="cloud in cloudList"
      :key="cloud.name"
      class="ylf-sky-hero__cloud"
      :class="`ylf-sky-hero__cloud--${cloud.name}`"
      :style="{ '--depth': cloud.depth, '--ylf-cloud-haze': cloud.haze }"
      aria-hidden="true"
    >
      <span class="ylf-sky-hero__drift">
        <span class="ylf-sky-hero__target" @click="poke(cloud, $event)" />
        <YlfCloud
          :shape="cloud.shape"
          :face="cloud.face"
          class="ylf-sky-hero__art"
          :class="{ 'ylf-squish': squished === cloud.name, 'is-awake': squished === cloud.name }"
          @animationend="squished = null"
        />
      </span>
    </span>

    <span
      v-for="rainbow in rainbows"
      :key="rainbow.id"
      class="ylf-sky-hero__rainbow"
      :style="{ left: `${rainbow.x}px`, top: `${rainbow.y}px`, width: `${rainbow.size}px` }"
      aria-hidden="true"
    />
    <span
      v-for="drop in drops"
      :key="drop.id"
      class="ylf-sky-hero__drop"
      :style="{
        'left': `${drop.x}px`,
        'top': `${drop.y}px`,
        '--fall': `${drop.fall}px`,
        '--drop': drop.color,
        'animationDelay': `${drop.delay}ms`,
      }"
      aria-hidden="true"
    />
    <Transition name="ylf-sky-hero-bubble">
      <span
        v-if="bubble"
        :key="bubble.id"
        class="ylf-sky-hero__bubble"
        :style="{ left: `${bubble.x}px`, top: `${bubble.y}px` }"
        aria-hidden="true"
      >{{ bubble.text }}</span>
    </Transition>

    <div class="ylf-sky-hero__content relative z-[3]">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.ylf-sky-hero {
  box-shadow: 0 28px 60px -30px color-mix(in srgb, #0b82c4 60%, transparent);
}

.ylf-sky-hero__scrim {
  background: linear-gradient(
    102deg,
    rgba(8, 32, 74, 0.5) 0%,
    rgba(8, 32, 74, 0.28) 40%,
    rgba(8, 32, 74, 0.07) 66%,
    transparent 84%
  );
}

/* 黄昏时分的几颗早星，缓慢呼吸。 */
.ylf-sky-hero__stars {
  position: absolute;
  z-index: 0;
  inset: 0 0 50%;
  opacity: 0;
  background:
    radial-gradient(1.5px 1.5px at 22% 24%, #fff4e8, transparent),
    radial-gradient(1px 1px at 36% 12%, #fff4e8, transparent),
    radial-gradient(1.5px 1.5px at 61% 18%, #fff4e8, transparent),
    radial-gradient(1px 1px at 74% 36%, #fff4e8, transparent),
    radial-gradient(1px 1px at 86% 14%, #fff4e8, transparent),
    radial-gradient(1.5px 1.5px at 48% 40%, #fff4e8, transparent);
}

.dark .ylf-sky-hero__stars {
  animation: ylf-sky-hero-twinkle 4.8s ease-in-out infinite;
  opacity: 0.85;
}

@keyframes ylf-sky-hero-twinkle {
  50% {
    opacity: 0.4;
  }
}

/* 内容层只让真正的控件接收指针，空白处的点击穿透到下面的云。 */
.ylf-sky-hero__content {
  pointer-events: none;
}

.ylf-sky-hero__content
  :deep(:is(a, button, input, select, textarea, label, [role='button'], [tabindex], [data-hero-interactive])) {
  pointer-events: auto;
}

/* ---- clouds ---- */
.ylf-sky-hero__cloud {
  position: absolute;
  z-index: 2;
  translate: calc(var(--px, 0) * var(--depth) * 16px) calc(var(--py, 0) * var(--depth) * 8px);
  transition: translate 1000ms var(--ylf-ease-standard);
}

.ylf-sky-hero__drift {
  position: relative;
  display: block;
  animation: ylf-sky-hero-drift calc(10s + var(--depth) * 4s) ease-in-out infinite alternate;
}

.ylf-sky-hero__target {
  position: absolute;
  z-index: 1;
  inset: 30% 12% 10%;
  border-radius: 48%;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.ylf-sky-hero__art {
  transform-origin: 50% 85%;
  filter: drop-shadow(0 10px 12px rgb(30 80 150 / 22%));
  transition: translate var(--ylf-duration-slow) var(--ylf-ease-spring);
}

.dark .ylf-sky-hero__art {
  filter: drop-shadow(0 10px 12px rgb(30 15 60 / 40%));
}

.ylf-sky-hero__drift:has(.ylf-sky-hero__target:hover) .ylf-sky-hero__art {
  translate: 0 -4px;
  --ylf-cloud-face-opacity: 0.85;
}

.ylf-sky-hero__art.is-awake {
  --ylf-cloud-face-opacity: 0.9;
}

/* full：个人中心大头图 */
.ylf-sky-hero__cloud--far {
  top: 2%;
  left: 40%;
  width: clamp(120px, 20%, 200px);
  filter: blur(1px);
  opacity: 0.7;
}

[data-clouds='full'] .ylf-sky-hero__cloud--bank {
  bottom: -14%;
  left: -6%;
  width: clamp(240px, 44%, 360px);
  opacity: 0.85;
}

[data-clouds='full'] .ylf-sky-hero__cloud--billow {
  top: -7%;
  right: 22%;
  width: clamp(140px, 24%, 200px);
}

[data-clouds='full'] .ylf-sky-hero__cloud--puff {
  top: 26%;
  right: -5%;
  width: clamp(120px, 20%, 170px);
}

/* mini：设置等页面的窄横幅，云都靠右，给标题让出位置 */
[data-clouds='mini'] .ylf-sky-hero__cloud--far {
  top: -6%;
  left: 46%;
  width: clamp(110px, 18%, 170px);
}

[data-clouds='mini'] .ylf-sky-hero__cloud--bank {
  right: 18%;
  bottom: -38%;
  width: clamp(200px, 36%, 300px);
  opacity: 0.8;
}

[data-clouds='mini'] .ylf-sky-hero__cloud--puff {
  top: -14%;
  right: 7%;
  width: clamp(110px, 20%, 160px);
}

/* ---- rain / rainbow / bubble ---- */
.ylf-sky-hero__drop {
  position: absolute;
  z-index: 2;
  width: 6px;
  height: 10px;
  margin-left: -3px;
  border-radius: 50% 50% 50% 50% / 62% 62% 38% 38%;
  background: var(--drop);
  opacity: 0;
  pointer-events: none;
  animation: ylf-sky-hero-rain 900ms cubic-bezier(0.5, 0, 0.9, 0.6) backwards;
}

.ylf-sky-hero__rainbow {
  position: absolute;
  z-index: 1;
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
  pointer-events: none;
  mask-image: linear-gradient(to top, transparent, #000 45%);
  animation: ylf-sky-hero-rainbow 2400ms var(--ylf-ease-standard) forwards;
}

.ylf-sky-hero__bubble {
  position: absolute;
  z-index: 4;
  max-width: 12rem;
  border-radius: 1rem 1rem 1rem 0.25rem;
  padding: 0.35rem 0.7rem;
  color: #1e3a6a;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 10px 24px -12px rgb(15 55 114 / 45%);
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
  translate: -50% -100%;
}

.ylf-sky-hero-bubble-enter-active {
  transition:
    opacity var(--ylf-duration-fast) var(--ylf-ease-standard),
    scale var(--ylf-duration-slow) var(--ylf-ease-spring);
}

.ylf-sky-hero-bubble-leave-active {
  transition: opacity var(--ylf-duration-exit) var(--ylf-ease-standard);
}

.ylf-sky-hero-bubble-enter-from {
  opacity: 0;
  scale: 0.6;
}

.ylf-sky-hero-bubble-leave-to {
  opacity: 0;
}

@keyframes ylf-sky-hero-drift {
  from {
    transform: translateX(-6px);
  }
  to {
    transform: translateX(8px);
  }
}

@keyframes ylf-sky-hero-rain {
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

@keyframes ylf-sky-hero-rainbow {
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

/* 窄屏：去掉远云，云朵缩小并贴边，不压住标题和数据条 */
@media (max-width: 639px) {
  .ylf-sky-hero__cloud--far {
    display: none;
  }

  [data-clouds='full'] .ylf-sky-hero__cloud--billow {
    top: 1%;
    right: -6%;
    width: 120px;
  }

  [data-clouds='full'] .ylf-sky-hero__cloud--bank {
    bottom: -8%;
    width: 220px;
  }

  [data-clouds='full'] .ylf-sky-hero__cloud--puff {
    display: none;
  }

  [data-clouds='mini'] .ylf-sky-hero__cloud--bank {
    right: -18%;
    width: 180px;
  }

  [data-clouds='mini'] .ylf-sky-hero__cloud--puff {
    top: -10%;
    right: -4%;
    width: 96px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ylf-sky-hero__drift,
  .dark .ylf-sky-hero__stars {
    animation: none;
  }

  .ylf-sky-hero__cloud,
  .ylf-sky-hero__drift:has(.ylf-sky-hero__target:hover) .ylf-sky-hero__art {
    translate: none;
  }
}
</style>

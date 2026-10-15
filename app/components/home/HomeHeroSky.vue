<script setup lang="ts">
import HomeCloud from './HomeCloud.vue'

// depth 决定视差幅度：越靠前的云跟随鼠标与滚动移动得越多。
// haze 是空气透视：越远的云越接近天空的颜色、对比越低。
const clouds = [
  { name: 'distant', shape: 'wisp', duration: '54s', delay: '-18s', depth: 0.25, haze: 0.6, enter: 380 },
  { name: 'high', shape: 'puff', duration: '46s', delay: '-12s', depth: 0.45, haze: 0.38, enter: 260 },
  { name: 'main', shape: 'billow', duration: '42s', delay: '-6s', depth: 0.7, haze: 0, enter: 120 },
  { name: 'foreground', shape: 'heap', duration: '58s', delay: '-22s', depth: 1, haze: 0, enter: 0 },
  { name: 'low', shape: 'bank', duration: '62s', delay: '-30s', depth: 0.85, haze: 0.14, enter: 60 },
] as const

const stars = [
  { x: 8, y: 9, s: 2, d: 0 },
  { x: 17, y: 22, s: 1.5, d: 1.2 },
  { x: 29, y: 6, s: 2.5, d: 2.1 },
  { x: 41, y: 16, s: 1.5, d: 0.6 },
  { x: 47, y: 4, s: 2, d: 2.8 },
  { x: 56, y: 26, s: 1.5, d: 1.7 },
  { x: 63, y: 8, s: 2, d: 0.3 },
  { x: 71, y: 19, s: 1.5, d: 2.4 },
  { x: 79, y: 5, s: 2.5, d: 1 },
  { x: 88, y: 14, s: 1.5, d: 3.1 },
  { x: 94, y: 30, s: 2, d: 1.5 },
  { x: 36, y: 31, s: 1.5, d: 2.6 },
]

// 主云可以戳：回弹一下、换一句话、撒一把多巴胺彩纸；连戳几下它会飘走再回来。
const pokeLines = [
  '软的，真的是软的。',
  '云朵：别闹，我在上班。',
  '再戳就要飘走啦。',
  '我又飘回来啦。',
]
const confettiColors = [
  'var(--ylf-palette-blue)',
  'var(--ylf-palette-cyan)',
  'var(--ylf-palette-green)',
  'var(--ylf-palette-sun)',
  'var(--ylf-palette-coral)',
  'var(--ylf-palette-pink)',
]

interface Confetti {
  id: number
  x: number
  y: number
  dx: number
  dy: number
  rotate: number
  color: string
  shape: 'dot' | 'chip' | 'star'
}

const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const root = shallowRef<HTMLElement | null>(null)
const pokes = shallowRef(0)
const squish = shallowRef(false)
const away = shallowRef(false)
const hintVisible = shallowRef(false)
const confetti = shallowRef<Confetti[]>([])
let confettiSeed = 0

const caption = computed(() => {
  if (pokes.value === 0)
    return '戳一下试试？'
  if (pokes.value <= pokeLines.length)
    return pokeLines[pokes.value - 1]
  return `这朵云已经被你戳了 ${pokes.value} 下`
})

function burst(x: number, y: number, count: number) {
  const pieces = Array.from({ length: count }, (_, index): Confetti => {
    const angle = (Math.PI * 2 * index) / count + Math.random() * 0.6
    const distance = 46 + Math.random() * 70
    return {
      id: ++confettiSeed,
      x,
      y,
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance - 24,
      rotate: Math.round(Math.random() * 540 - 270),
      color: confettiColors[index % confettiColors.length]!,
      shape: index % 3 === 0 ? 'star' : index % 3 === 1 ? 'chip' : 'dot',
    }
  })
  confetti.value = [...confetti.value, ...pieces]
  const ids = new Set(pieces.map(piece => piece.id))
  setTimeout(() => {
    confetti.value = confetti.value.filter(piece => !ids.has(piece.id))
  }, 1100)
}

function poke(event: MouseEvent) {
  if (away.value)
    return

  pokes.value++
  hintVisible.value = true

  const box = root.value?.getBoundingClientRect()
  const target = (event.currentTarget as HTMLElement).getBoundingClientRect()
  // 键盘触发时没有指针坐标，从云朵中心撒彩纸。
  const clientX = event.detail === 0 ? target.left + target.width / 2 : event.clientX
  const clientY = event.detail === 0 ? target.top + target.height / 2 : event.clientY
  if (box)
    burst(clientX - box.left, clientY - box.top, pokes.value === 3 ? 18 : 10)

  if (pokes.value === 3 && !reducedMotion.value) {
    away.value = true
    return
  }

  squish.value = false
  requestAnimationFrame(() => {
    squish.value = true
  })
}

function onCloudAnimationEnd(event: AnimationEvent) {
  if (event.animationName.includes('home-cloud-away')) {
    away.value = false
    pokes.value = 4
  }
  squish.value = false
}

onMounted(() => {
  // 稍等云朵入场后再冒出提示，让访客知道这朵云可以戳。
  setTimeout(() => {
    hintVisible.value = true
  }, 2600)
})
</script>

<template>
  <div ref="root" class="home-hero-sky">
    <SkyScene clouds="none" :sun="false" />
    <div class="home-hero-sky__atmosphere" aria-hidden="true" />

    <div class="home-hero-sky__stars" aria-hidden="true">
      <span
        v-for="(star, index) in stars"
        :key="index"
        :style="{ 'left': `${star.x}%`, 'top': `${star.y}%`, '--star-size': `${star.s}px`, 'animationDelay': `${star.d}s` }"
      />
    </div>

    <div class="home-hero-sky__celestial" aria-hidden="true">
      <!-- 穿过云隙的丁达尔光束，向标题方向斜斜洒下。 -->
      <span class="home-hero-sky__rays">
        <span v-for="(angle, index) in [16, 34, 52, 70]" :key="angle" :style="{ '--ray': `${angle}deg`, '--i': index }" />
      </span>
      <!-- 月光不打光束，只在月亮周围晕开一圈柔光。 -->
      <span class="home-hero-sky__halo" />
      <span class="home-hero-sky__sun" />
      <span class="home-hero-sky__moon" />
    </div>

    <span
      v-for="cloud in clouds"
      :key="cloud.name"
      class="home-hero-sky__layer"
      :class="`home-hero-sky__layer--${cloud.name}`"
      :style="{ '--depth': cloud.depth, '--enter-delay': `${cloud.enter}ms` }"
    >
      <component
        :is="cloud.name === 'main' ? 'button' : 'span'"
        class="home-hero-sky__float"
        :class="{ 'home-hero-sky__poke': cloud.name === 'main' }"
        v-bind="cloud.name === 'main' ? { 'type': 'button', 'aria-label': '戳一下云朵' } : { 'aria-hidden': 'true' }"
        @click="cloud.name === 'main' ? poke($event) : undefined"
      >
        <span v-if="cloud.name === 'main'" class="home-hero-sky__poke-target" aria-hidden="true" />
        <span
          class="home-hero-sky__squish"
          :class="cloud.name === 'main' && { 'is-squished': squish, 'is-away': away }"
          @animationend="cloud.name === 'main' && onCloudAnimationEnd($event)"
        >
          <HomeCloud
            class="home-hero-sky__cloud"
            :shape="cloud.shape"
            :volumetric="cloud.name === 'main'"
            :face="cloud.name === 'main'"
            :style="{ '--drift-duration': cloud.duration, '--drift-delay': cloud.delay, '--haze': cloud.haze }"
          />
        </span>
      </component>

      <span
        v-if="cloud.name === 'main'"
        class="home-hero-sky__bubble"
        :class="{ 'is-visible': hintVisible && !away }"
        aria-live="polite"
      >
        <span :key="caption">{{ caption }}</span>
      </span>
    </span>

    <span
      v-for="piece in confetti"
      :key="piece.id"
      class="home-hero-sky__confetti"
      :class="`home-hero-sky__confetti--${piece.shape}`"
      :style="{
        'left': `${piece.x}px`,
        'top': `${piece.y}px`,
        '--dx': `${piece.dx}px`,
        '--dy': `${piece.dy}px`,
        '--rot': `${piece.rotate}deg`,
        '--confetti': piece.color,
      }"
      aria-hidden="true"
    />
  </div>
</template>

<style scoped>
.home-hero-sky {
  --home-ray-color: rgb(255 250 226 / 26%);
  /* 远处的云向这个天空色靠拢。 */
  --home-sky-haze: #9cc6ef;
  position: absolute;
  inset: 0;
  overflow: hidden;
  isolation: isolate;
  pointer-events: none;
}

.home-hero-sky__atmosphere {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 84% 24%, rgb(255 252 236 / 24%), transparent 48%),
    linear-gradient(100deg, rgb(15 55 114 / 44%), rgb(25 76 132 / 12%) 48%, transparent 72%);
}

/* ---- stars (dusk only) ---- */
.home-hero-sky__stars {
  position: absolute;
  inset: 0 0 50%;
  opacity: 0;
  transition: opacity var(--ylf-duration-slow) var(--ylf-ease-standard);
}

.home-hero-sky__stars span {
  position: absolute;
  width: var(--star-size);
  height: var(--star-size);
  border-radius: 50%;
  background: #fff7ea;
  box-shadow: 0 0 6px 1px rgb(255 240 220 / 55%);
  animation: home-star-twinkle 3.6s ease-in-out infinite;
}

.dark .home-hero-sky__stars {
  opacity: 1;
}

/* ---- sun / moon ---- */
.home-hero-sky__celestial {
  position: absolute;
  top: 12%;
  right: 31%;
  width: clamp(64px, 7vw, 104px);
  aspect-ratio: 1;
  translate: calc(var(--px, 0) * -6px) calc(var(--py, 0) * -4px + var(--scroll, 0) * 0.18px);
  transition: translate 1100ms var(--ylf-ease-standard);
  animation: home-sky-rise 1400ms var(--ylf-ease-spring) 240ms backwards;
}

.home-hero-sky__rays {
  position: absolute;
  z-index: -1;
  top: 50%;
  left: 50%;
  /* 模糊放在外层：clip-path 在 filter 之后生效，写在光束自身上会把柔边重新裁硬。 */
  filter: blur(12px);
  transition: opacity var(--ylf-duration-slow) var(--ylf-ease-standard);
}

.dark .home-hero-sky__rays {
  opacity: 0;
}

.home-hero-sky__rays span {
  position: absolute;
  top: 0;
  left: -3.5rem;
  width: 7rem;
  height: min(58vh, 460px);
  background: linear-gradient(var(--home-ray-color), transparent 80%);
  clip-path: polygon(44% 0, 56% 0, 100% 100%, 0 100%);
  transform-origin: 50% 0;
  rotate: var(--ray);
  animation: home-ray-breathe 9s ease-in-out calc(var(--i) * -2.2s) infinite;
}

.home-hero-sky__halo {
  position: absolute;
  inset: -70%;
  border-radius: 50%;
  background: radial-gradient(circle, rgb(255 222 200 / 30%) 0, rgb(255 210 190 / 12%) 38%, transparent 68%);
  opacity: 0;
  transition: opacity var(--ylf-duration-slow) var(--ylf-ease-standard);
}

.dark .home-hero-sky__halo {
  opacity: 1;
  animation: home-sun-halo 6s ease-in-out infinite;
}

.home-hero-sky__sun,
.home-hero-sky__moon {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  transition:
    opacity var(--ylf-duration-slow) var(--ylf-ease-standard),
    transform var(--ylf-duration-slow) var(--ylf-ease-spring);
}

.home-hero-sky__sun {
  border: 1px solid color-mix(in srgb, var(--ylf-palette-sun) 70%, #fff);
  background: radial-gradient(circle at 36% 32%, #fff6c4, var(--ylf-palette-sun) 62%);
  box-shadow:
    inset 0 3px 6px rgb(255 255 255 / 55%),
    0 0 60px 18px rgb(255 236 150 / 38%);
}

.home-hero-sky__sun::before,
.home-hero-sky__sun::after {
  content: '';
  position: absolute;
  inset: -18%;
  border-radius: 50%;
  background: color-mix(in srgb, var(--ylf-palette-sun) 16%, transparent);
  animation: home-sun-halo 4.8s ease-in-out infinite;
}

.home-hero-sky__sun::after {
  inset: -38%;
  background: color-mix(in srgb, var(--ylf-palette-sun) 8%, transparent);
  animation-delay: -2.4s;
}

.home-hero-sky__moon {
  opacity: 0;
  background:
    radial-gradient(circle at 30% 78%, rgb(140 104 120 / 28%), transparent 48%),
    radial-gradient(circle at 62% 28%, #fff8ec, #ffe3c4 55%, #f2b99c);
  box-shadow: 0 0 46px 10px rgb(255 214 190 / 30%);
  mask-image: radial-gradient(circle at 74% 30%, transparent 40%, #000 41%);
  transform: translateY(14px) rotate(-18deg) scale(0.9);
}

.dark .home-hero-sky__sun {
  opacity: 0;
  transform: translateY(24px) scale(0.85);
}

.dark .home-hero-sky__moon {
  opacity: 1;
  transform: rotate(-18deg);
}

/* ---- cloud layers: scroll parallax › pointer parallax › squish › drift ---- */
.home-hero-sky__layer {
  position: absolute;
  z-index: 1;
  width: var(--cloud-width);
  translate: 0 calc(var(--scroll, 0) * var(--depth) * -0.32px);
  animation: home-cloud-enter 1500ms var(--ylf-ease-spring) var(--enter-delay) backwards;
}

.home-hero-sky__float {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  translate: calc(var(--px, 0) * var(--depth) * 22px) calc(var(--py, 0) * var(--depth) * 12px);
  transition: translate 1100ms var(--ylf-ease-standard);
}

.home-hero-sky__squish {
  display: block;
  transform-origin: 50% 85%;
}

.home-hero-sky__cloud {
  opacity: var(--cloud-opacity, 1);
  /* 只给远景云加模糊；近景保持清晰，也省掉整层滤镜的重绘。 */
  filter: var(--cloud-filter, none);
  mask-image: linear-gradient(#000 65%, rgb(0 0 0 / 88%) 77%, transparent 98%);
  transform: translate3d(0, 0, 0) scaleX(var(--cloud-flip, 1));
  animation: home-cloud-drift var(--drift-duration) ease-in-out var(--drift-delay) infinite alternate;
}

.home-hero-sky__layer--distant {
  --cloud-width: clamp(160px, 18vw, 280px);
  --cloud-opacity: 0.62;
  --cloud-filter: blur(1.8px);
  top: 11%;
  right: 33%;
}

.home-hero-sky__layer--high {
  --cloud-width: clamp(150px, 15vw, 230px);
  --cloud-opacity: 0.82;
  --cloud-filter: blur(1px);
  --cloud-flip: -1;
  top: -1%;
  right: 1%;
}

.home-hero-sky__layer--main {
  --cloud-width: clamp(310px, 35vw, 520px);
  z-index: 3;
  top: 23%;
  right: 2%;
}

.home-hero-sky__layer--foreground {
  --cloud-width: clamp(480px, 52vw, 780px);
  z-index: 4;
  right: -12%;
  bottom: -25%;
}

.home-hero-sky__layer--low {
  --cloud-width: clamp(320px, 38vw, 560px);
  --cloud-opacity: 0.78;
  --cloud-filter: blur(0.6px);
  z-index: 4;
  left: -10%;
  bottom: -20%;
}

/* ---- the pokeable cloud ---- */
.home-hero-sky__poke {
  position: relative;
  pointer-events: none;
  -webkit-tap-highlight-color: transparent;
}

.home-hero-sky__poke:focus-visible {
  outline: none;
}

/* 只让云朵本体可点，避免整片天空都变成按钮。 */
.home-hero-sky__poke-target {
  position: absolute;
  z-index: 1;
  inset: 14% 10% 16% 6%;
  border-radius: 48%;
  pointer-events: auto;
  cursor: pointer;
}

.home-hero-sky__poke:focus-visible .home-hero-sky__poke-target {
  outline: 2px solid #fff;
  outline-offset: 4px;
}

/* 悬停、聚焦或被戳时，主云的小脸露出来。 */
.home-hero-sky__poke:hover .home-hero-sky__cloud,
.home-hero-sky__poke:focus-visible .home-hero-sky__cloud,
.home-hero-sky__squish.is-squished .home-hero-sky__cloud {
  --cloud-face-opacity: 0.85;
}

.home-hero-sky__squish.is-squished {
  animation: home-cloud-squish 640ms var(--ylf-ease-standard);
}

.home-hero-sky__squish.is-away {
  animation: home-cloud-away 2600ms var(--ylf-ease-standard);
}

.home-hero-sky__bubble {
  position: absolute;
  z-index: 2;
  top: 4%;
  left: 6%;
  max-width: 15rem;
  padding: 0.45rem 0.8rem;
  border: 1px solid rgb(255 255 255 / 70%);
  border-radius: 1rem 1rem 1rem 0.3rem;
  background: rgb(255 255 255 / 88%);
  box-shadow: 0 10px 24px -12px rgb(16 50 100 / 45%);
  color: #183257;
  font-size: 0.8rem;
  font-weight: 600;
  line-height: 1.4;
  white-space: nowrap;
  opacity: 0;
  translate: calc(var(--px, 0) * var(--depth) * 22px) calc(var(--py, 0) * var(--depth) * 12px);
  transform: translateY(8px) scale(0.8);
  transform-origin: 0 100%;
  transition:
    opacity var(--ylf-duration-fast) var(--ylf-ease-standard),
    transform var(--ylf-duration-slow) var(--ylf-ease-spring),
    translate 1100ms var(--ylf-ease-standard);
}

.home-hero-sky__bubble.is-visible {
  opacity: 1;
  transform: none;
}

.home-hero-sky__bubble > span {
  display: inline-block;
  animation: home-bubble-pop 420ms var(--ylf-ease-spring);
}

.dark .home-hero-sky__bubble {
  border-color: rgb(255 230 220 / 30%);
  background: rgb(40 30 70 / 82%);
  color: #ffeadf;
}

/* ---- confetti ---- */
.home-hero-sky__confetti {
  position: absolute;
  z-index: 6;
  width: 9px;
  height: 9px;
  margin: -4.5px 0 0 -4.5px;
  background: var(--confetti);
  animation: home-confetti 1000ms cubic-bezier(0.15, 0.7, 0.3, 1) forwards;
}

.home-hero-sky__confetti--dot {
  border-radius: 50%;
}

.home-hero-sky__confetti--chip {
  width: 6px;
  height: 12px;
  border-radius: 2px;
}

.home-hero-sky__confetti--star {
  width: 12px;
  height: 12px;
  clip-path: polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%);
}

/* ---- dusk palette ---- */
.dark .home-hero-sky {
  --home-sky-haze: #a48cc4;
}

.dark .home-hero-sky__atmosphere {
  background:
    radial-gradient(ellipse at 84% 24%, rgb(255 198 176 / 14%), transparent 48%),
    linear-gradient(100deg, rgb(24 22 65 / 54%), rgb(46 34 84 / 18%) 48%, transparent 72%);
}

@keyframes home-cloud-drift {
  from {
    transform: translate3d(-10px, 4px, 0) scaleX(var(--cloud-flip, 1));
  }
  to {
    transform: translate3d(12px, -5px, 0) scaleX(var(--cloud-flip, 1));
  }
}

@keyframes home-cloud-enter {
  from {
    opacity: 0;
    transform: translateX(calc(var(--depth) * 90px)) scale(0.92);
  }
}

@keyframes home-ray-breathe {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}

@keyframes home-sky-rise {
  from {
    opacity: 0;
    transform: translateY(48px) scale(0.8);
  }
}

@keyframes home-sun-halo {
  0%,
  100% {
    transform: scale(0.94);
    opacity: 0.7;
  }
  50% {
    transform: scale(1.06);
    opacity: 1;
  }
}

@keyframes home-star-twinkle {
  0%,
  100% {
    opacity: 0.25;
    transform: scale(0.7);
  }
  50% {
    opacity: 1;
    transform: scale(1.15);
  }
}

@keyframes home-cloud-squish {
  18% {
    transform: scale(1.07, 0.88);
  }
  42% {
    transform: scale(0.95, 1.06) translateY(-8px);
  }
  66% {
    transform: scale(1.02, 0.98);
  }
}

@keyframes home-cloud-away {
  10% {
    transform: scale(1.05, 0.9);
  }
  38% {
    opacity: 0;
    transform: translate(140px, -120px) scale(0.7) rotate(8deg);
  }
  62% {
    opacity: 0;
    transform: translate(-160px, 30px) scale(0.85);
  }
  86% {
    opacity: 1;
    transform: translate(10px, 0) scale(1.02);
  }
}

@keyframes home-bubble-pop {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.9);
  }
}

@keyframes home-confetti {
  0% {
    opacity: 1;
    transform: translate(0, 0) rotate(0) scale(0.4);
  }
  70% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translate(var(--dx), calc(var(--dy) + 40px)) rotate(var(--rot)) scale(1);
  }
}

@media (max-width: 767px) {
  .home-hero-sky__celestial {
    top: 6%;
    right: 12%;
  }

  .home-hero-sky__layer--distant {
    top: 1%;
    right: 28%;
  }

  .home-hero-sky__layer--high {
    top: -5%;
    right: -16%;
  }

  .home-hero-sky__layer--main {
    --cloud-width: 280px;
    --cloud-opacity: 0.84;
    top: auto;
    right: -22%;
    bottom: -9%;
  }

  .home-hero-sky__layer--foreground {
    --cloud-width: 400px;
    right: -48%;
    bottom: -23%;
  }

  .home-hero-sky__layer--low {
    --cloud-width: 260px;
    left: -25%;
    bottom: -23%;
  }

  /* 手机上主云贴着底边，提示气泡容易压住按钮。 */
  .home-hero-sky__bubble {
    display: none;
  }
}

@media (min-width: 768px) and (max-width: 1023px) {
  .home-hero-sky__layer--main {
    --cloud-width: 320px;
    top: auto;
    right: -4%;
    bottom: 6%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .home-hero-sky__layer,
  .home-hero-sky__celestial,
  .home-hero-sky__rays span,
  .home-hero-sky__halo,
  .home-hero-sky__cloud,
  .home-hero-sky__sun::before,
  .home-hero-sky__sun::after,
  .home-hero-sky__stars span,
  .home-hero-sky__squish,
  .home-hero-sky__bubble > span {
    animation: none !important;
  }

  .home-hero-sky__confetti {
    display: none;
  }

  .home-hero-sky :deep(.ylf-bird) {
    animation: none;
  }
}
</style>

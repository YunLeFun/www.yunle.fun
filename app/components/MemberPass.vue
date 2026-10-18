<script setup lang="ts">
/**
 * 晴空玻璃会员卡 —— 移植自设计稿 dreamy.jsx 的 DreamPass。
 *
 * 一张以「晴空」为底、可以拿在手里把玩的会员卡：
 * - 指针在卡面移动时轻微倾斜，表面一道随光移动的虹彩高光；
 * - 已开通：轻点翻到背面，看剩余晴空天数、会员编号与已点亮的权益；
 * - 未开通：两团卡通云遮住卡面，悬停时笑着向两侧推开，点击发出 unlock 引导去开通。
 * - 卡面上的小云有脸：眼睛跟着指针看，随倾斜做视差；戳一下会 Q 弹、眯眼笑、冒出小星星。
 * 个人中心 / 会员权益页复用；倾斜与翻面在 prefers-reduced-motion 下关闭。
 */
const props = withDefaults(defineProps<{
  member?: boolean
  name?: string
  /** 有效期文案，如 2026 / 07 */
  expire?: string
  /** 到期时间戳（ms），用于背面的剩余天数 */
  expireAt?: number | null
  /** 当前周期，决定剩余进度条的满格长度 */
  cycle?: 'month' | 'year'
  /** 会员编号，展示在背面 */
  serial?: string
  /** 不传则跟随站点明暗模式 */
  theme?: 'light' | 'dark'
  /** 关闭后只是一张静态卡片 */
  interactive?: boolean
}>(), {
  member: false,
  name: '晴空旅人',
  expire: '—— / ——',
  expireAt: null,
  cycle: 'month',
  serial: '',
  interactive: true,
})

const emit = defineEmits<{
  unlock: []
}>()

const PERKS = [
  { icon: 'i-lucide-refresh-cw', label: '同步' },
  { icon: 'i-lucide-bookmark', label: '收藏' },
  { icon: 'i-lucide-layers', label: '通用' },
  { icon: 'i-lucide-infinity', label: '免扣' },
  { icon: 'i-lucide-shield-off', label: '去广告' },
  { icon: 'i-lucide-headphones', label: '客服' },
]

type CloudShape = 'round' | 'long' | 'small'
interface PassCloud {
  id: string
  shape: CloudShape
  face?: boolean
  /** 视差深度（px），越大越靠前 */
  depth: number
  /** 漂浮节奏的错开序号；不传则静止 */
  float?: number
  style: Record<string, string>
}

/** 已开通正面：一大一小两朵有脸的云 + 远处一朵小云，避开顶部标识与底部信息条 */
const FRONT_CLOUDS: PassCloud[] = [
  { id: 'front-big', shape: 'round', face: true, depth: 16, float: 0, style: { width: '27%', right: '8%', top: '25%' } },
  { id: 'front-small', shape: 'small', face: true, depth: 9, float: 1, style: { width: '18%', left: '19%', top: '36%' } },
  { id: 'front-far', shape: 'small', depth: 4, float: 2, style: { width: '11%', left: '52%', top: '13%', opacity: '0.7' } },
]

/** 未开通：左右两堆云，前排各一朵有脸 */
const LOCK_LEFT: PassCloud[] = [
  { id: 'lock-l1', shape: 'round', face: true, depth: 10, style: { width: '78%', left: '-14%', top: '-16%' } },
  { id: 'lock-l2', shape: 'small', depth: 6, style: { width: '64%', left: '2%', top: '30%' } },
  { id: 'lock-l3', shape: 'long', depth: 14, style: { width: '130%', left: '-20%', bottom: '-14%' } },
]
const LOCK_RIGHT: PassCloud[] = [
  { id: 'lock-r1', shape: 'small', depth: 6, style: { width: '70%', right: '-12%', top: '-4%' } },
  { id: 'lock-r2', shape: 'round', face: true, depth: 10, style: { width: '72%', right: '-2%', top: '26%' } },
  { id: 'lock-r3', shape: 'long', depth: 14, style: { width: '124%', right: '-22%', bottom: '-16%' } },
]

const BACK_CLOUDS: PassCloud[] = [
  { id: 'back-long', shape: 'long', face: true, depth: 10, float: 0, style: { width: '46%', right: '-8%', bottom: '-6%' } },
  { id: 'back-small', shape: 'small', depth: 5, float: 2, style: { width: '20%', left: '42%', top: '4%', opacity: '0.6' } },
]

const CLOUD_BY_ID = new Map(
  [...FRONT_CLOUDS, ...LOCK_LEFT, ...LOCK_RIGHT, ...BACK_CLOUDS].map(cloud => [cloud.id, cloud]),
)

interface Sparkle { id: number, face: 'front' | 'back', x: number, y: number }

const DAY_MS = 86_400_000
/** 与 CSS 里 --flip-duration 保持一致 */
const FLIP_MS = 640
const flipped = ref(false)
/** 翻面进行中：暂停毛玻璃 / 投影等重绘开销，并忽略连点 */
const flipping = ref(false)
const pointer = reactive({ x: 0.5, y: 0.5, active: false })
const canTilt = ref(false)
const stage = useTemplateRef<HTMLElement>('stage')
const hovered = ref(false)
const focused = ref(false)
/** 正在 Q 弹 / 眯眼笑的云 */
const squishing = reactive<Record<string, boolean>>({})
const smiling = reactive<Record<string, boolean>>({})
const sparkles = ref<Sparkle[]>([])
let sparkleSeq = 0
const timers = new Set<ReturnType<typeof setTimeout>>()

/** 云朵的视线：跟着指针，离开时回正 */
const look = computed(() => pointer.active
  ? { x: (pointer.x - 0.5) * 2, y: (pointer.y - 0.5) * 2 }
  : undefined)

const daysLeft = computed(() => {
  if (!props.expireAt)
    return null
  return Math.max(0, Math.ceil((props.expireAt - Date.now()) / DAY_MS))
})
const progress = computed(() => {
  if (daysLeft.value === null)
    return 0
  const full = props.cycle === 'year' ? 365 : 31
  return Math.min(1, Math.max(0.04, daysLeft.value / full))
})

const stageStyle = computed(() => ({
  '--px': pointer.x,
  '--py': pointer.y,
  '--rx': `${pointer.active ? (0.5 - pointer.y) * 10 : 0}deg`,
  '--ry': `${pointer.active ? (pointer.x - 0.5) * 14 : 0}deg`,
}))

const label = computed(() => {
  if (!props.member)
    return '会员卡未点亮，点击选择会员方案'
  return flipped.value ? '会员卡背面，点击翻回正面' : '会员卡正面，点击翻面查看剩余天数'
})

onMounted(() => {
  canTilt.value = window.matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)').matches
})

watch(() => props.member, (member) => {
  if (!member)
    flipped.value = false
})

function onPointerMove(event: PointerEvent) {
  if (!props.interactive || !canTilt.value)
    return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  pointer.x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  pointer.y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
  pointer.active = true
}

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

function cloudMood(cloud: PassCloud, lock = false) {
  // 未开通的云在悬停 / 聚焦时笑着让路
  if (smiling[cloud.id] || (lock && (hovered.value || focused.value)))
    return 'happy'
  return 'calm'
}

/**
 * 戳云：Q 弹一下、眯眼笑一会儿、冒一颗小星星。
 * 已开通时拦下点击，不让卡片跟着翻面；未开通时照常放行到 unlock。
 */
function pokeCloud(cloud: PassCloud, face: 'front' | 'back', event: MouseEvent, el: Element) {
  squishing[cloud.id] = false
  requestAnimationFrame(() => {
    squishing[cloud.id] = true
  })
  later(() => {
    squishing[cloud.id] = false
  }, 660)

  smiling[cloud.id] = true
  later(() => {
    smiling[cloud.id] = false
  }, 1400)

  const host = el.closest('.ylf-pass-face')
  if (!host)
    return
  const rect = host.getBoundingClientRect()
  const sparkle: Sparkle = {
    id: ++sparkleSeq,
    face,
    x: ((event.clientX - rect.left) / rect.width) * 100,
    y: ((event.clientY - rect.top) / rect.height) * 100,
  }
  sparkles.value = [...sparkles.value.slice(-4), sparkle]
  later(() => {
    sparkles.value = sparkles.value.filter(item => item.id !== sparkle.id)
  }, 900)
}

function onPointerLeave() {
  hovered.value = false
  pointer.active = false
  pointer.x = 0.5
  pointer.y = 0.5
}

/**
 * 点击落在哪朵云上。卡片处在 3D 变换里，Chrome 对内层元素的命中测试不稳定，
 * 所以统一由卡片接住点击，再按各朵云的屏幕矩形判断；键盘触发的点击没有坐标，不会命中。
 */
function findCloudAt(event: MouseEvent) {
  if (!stage.value || (!event.clientX && !event.clientY))
    return null
  const face = flipped.value ? 'back' : 'front'
  const els = [...stage.value.querySelectorAll(`.ylf-pass-${face} [data-cloud]`)].reverse()
  for (const el of els) {
    const rect = el.getBoundingClientRect()
    // 只取云朵主体（矩形中部偏下），四角是透明区域
    const inX = event.clientX > rect.left + rect.width * 0.08 && event.clientX < rect.right - rect.width * 0.08
    const inY = event.clientY > rect.top + rect.height * 0.15 && event.clientY < rect.bottom
    const cloud = CLOUD_BY_ID.get((el as HTMLElement).dataset.cloud ?? '')
    if (inX && inY && cloud)
      return { cloud, face, el } as const
  }
  return null
}

function onActivate(event: MouseEvent) {
  if (!props.interactive)
    return
  const hit = findCloudAt(event)
  if (hit) {
    pokeCloud(hit.cloud, hit.face, event, hit.el)
    // 已开通时戳云不翻面；未开通时戳云同样去开通
    if (props.member)
      return
  }
  if (props.member)
    flip()
  else
    emit('unlock')
}

function flip() {
  if (flipping.value)
    return
  flipped.value = !flipped.value
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    return
  flipping.value = true
  later(() => {
    flipping.value = false
  }, FLIP_MS)
}
</script>

<template>
  <div
    ref="stage"
    class="ylf-pass-stage"
    :class="{ 'is-tilting': pointer.active, 'is-static': !interactive }"
    :style="stageStyle"
    @pointerenter="hovered = true"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
  >
    <component
      :is="interactive ? 'button' : 'div'"
      :type="interactive ? 'button' : undefined"
      class="ylf-pass-tilt group/pass"
      :aria-label="interactive ? label : undefined"
      :aria-pressed="interactive && member ? flipped : undefined"
      @click="onActivate"
      @focus="focused = true"
      @blur="focused = false"
    >
      <div class="ylf-pass-flipper" :class="{ 'is-flipped': flipped, 'is-flipping': flipping }">
        <!-- 正面 -->
        <div class="ylf-pass-face ylf-pass-front" :aria-hidden="flipped || undefined">
          <SkyScene :theme="theme" :sun="false" clouds="none" sun-x="72%" sun-y="18%" class="pointer-events-none" />

          <!-- 卡通小云：跟着指针看、随倾斜视差，戳一下会弹 -->
          <template v-if="member">
            <span
              v-for="cloud in FRONT_CLOUDS"
              :key="cloud.id"
              class="ylf-pass-cloud z-[1]"
              :class="cloud.float !== undefined ? `is-float is-float-${cloud.float}` : undefined"
              :style="{ ...cloud.style, '--depth': cloud.depth }"
              aria-hidden="true"
              :data-cloud="cloud.id"
            >
              <CuteCloud
                :shape="cloud.shape"
                :face="cloud.face"
                :mood="cloudMood(cloud)"
                :look="look"
                :class="{ 'ylf-squish': squishing[cloud.id] }"
              />
            </span>
          </template>
          <!-- 底部压暗，保证玻璃信息条清晰 -->
          <div class="ylf-pass-fade pointer-events-none absolute inset-0 z-[2]" />

          <!-- 顶部：云朵标识 + logo -->
          <div class="absolute inset-x-4 top-4 z-[5] flex items-center justify-between text-white">
            <span class="ylf-pass-shadow inline-flex items-center gap-2">
              <span class="ylf-pass-tile inline-flex size-9 items-center justify-center rounded-xl">
                <Icon name="i-lucide-cloud" class="size-5" />
              </span>
              <span class="text-sm font-bold">云乐坊会员</span>
            </span>
            <span class="flex items-center gap-2">
              <span
                v-if="member && interactive"
                class="ylf-pass-hint inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-semibold"
              >
                <Icon name="i-lucide-rotate-3d" class="size-3" />
                轻点翻面
              </span>
              <YlfLogo class="h-6 w-9 text-white/90" aria-hidden="true" />
            </span>
          </div>

          <!-- 玻璃信息条 -->
          <div v-if="member" class="ylf-pass-strip absolute inset-x-3.5 bottom-3.5 z-[5] flex items-end justify-between rounded-2xl px-4 py-3 text-left text-white">
            <div class="min-w-0">
              <div class="text-[11px] tracking-[0.15em] opacity-90">
                跨应用通用 · CROSS-APP
              </div>
              <div class="mt-0.5 truncate text-xl font-bold">
                {{ member ? name : '晴空旅人' }}
              </div>
            </div>
            <div class="shrink-0 text-right">
              <div class="text-[9.5px] tracking-[0.12em] opacity-90">
                VALID THRU
              </div>
              <div class="text-sm font-bold tabular-nums">
                {{ member ? expire : '—— / ——' }}
              </div>
            </div>
          </div>

          <!-- 未开通：两团云遮住卡面，悬停时推开 -->
          <div v-if="!member" class="ylf-pass-lock absolute inset-0 z-[6]">
            <div class="ylf-pass-bank ylf-pass-bank--left">
              <span
                v-for="cloud in LOCK_LEFT"
                :key="cloud.id"
                class="ylf-pass-cloud ylf-pass-puff"
                :style="{ ...cloud.style, '--depth': cloud.depth }"
                aria-hidden="true"
                :data-cloud="cloud.id"
              >
                <CuteCloud
                  :shape="cloud.shape"
                  :face="cloud.face"
                  :mood="cloudMood(cloud, true)"
                  :look="look"
                  :class="{ 'ylf-squish': squishing[cloud.id] }"
                />
              </span>
            </div>
            <div class="ylf-pass-bank ylf-pass-bank--right">
              <span
                v-for="cloud in LOCK_RIGHT"
                :key="cloud.id"
                class="ylf-pass-cloud ylf-pass-puff"
                :style="{ ...cloud.style, '--depth': cloud.depth }"
                aria-hidden="true"
                :data-cloud="cloud.id"
              >
                <CuteCloud
                  :shape="cloud.shape"
                  :face="cloud.face"
                  :mood="cloudMood(cloud, true)"
                  :look="look"
                  :class="{ 'ylf-squish': squishing[cloud.id] }"
                />
              </span>
            </div>
            <div class="relative z-[2] flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <span class="ylf-pass-key inline-flex size-12 items-center justify-center rounded-full">
                <Icon name="i-lucide-sun" class="size-6" />
              </span>
              <span class="ylf-pass-lock-label flex flex-col items-center gap-0.5 rounded-2xl px-4 py-2">
                <span class="ylf-pass-lock-title text-[15px] font-bold">推开云层 · 点亮晴空</span>
                <span v-if="interactive" class="ylf-pass-lock-sub inline-flex items-center gap-1 text-xs font-semibold">
                  选择方案
                  <Icon name="i-lucide-arrow-down" class="size-3.5" />
                </span>
              </span>
            </div>
          </div>

          <!-- 虹彩高光：随指针移动 -->
          <div class="ylf-pass-glare pointer-events-none absolute inset-0 z-[8]" />

          <span
            v-for="sparkle in sparkles.filter(item => item.face === 'front')"
            :key="sparkle.id"
            class="ylf-pass-sparkle z-[9]"
            :style="{ left: `${sparkle.x}%`, top: `${sparkle.y}%` }"
            aria-hidden="true"
          >
            <Icon name="i-lucide-sparkles" class="size-4" />
          </span>
        </div>

        <!-- 背面：剩余晴空 -->
        <div v-if="member" class="ylf-pass-face ylf-pass-back" :aria-hidden="!flipped || undefined">
          <div class="ylf-pass-back-sky pointer-events-none absolute inset-0" />
          <span
            v-for="cloud in BACK_CLOUDS"
            :key="cloud.id"
            class="ylf-pass-cloud z-[3]"
            :class="cloud.float !== undefined ? `is-float is-float-${cloud.float}` : undefined"
            :style="{ ...cloud.style, '--depth': cloud.depth }"
            aria-hidden="true"
            :data-cloud="cloud.id"
          >
            <CuteCloud
              :shape="cloud.shape"
              :face="cloud.face"
              :mood="cloudMood(cloud)"
              :look="look"
              :class="{ 'ylf-squish': squishing[cloud.id] }"
            />
          </span>
          <span
            v-for="sparkle in sparkles.filter(item => item.face === 'back')"
            :key="sparkle.id"
            class="ylf-pass-sparkle z-[9]"
            :style="{ left: `${sparkle.x}%`, top: `${sparkle.y}%` }"
            aria-hidden="true"
          >
            <Icon name="i-lucide-sparkles" class="size-4" />
          </span>

          <div class="relative z-[2] flex h-full flex-col justify-between p-4 text-left text-white sm:p-5">
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="text-[10.5px] tracking-[0.18em] opacity-85">
                  SKY PASS
                </div>
                <div class="text-sm font-bold">
                  晴空通行证
                </div>
              </div>
              <div v-if="serial" class="text-right">
                <div class="text-[9.5px] tracking-[0.12em] opacity-85">
                  NO.
                </div>
                <div class="font-mono text-xs font-semibold tracking-wider">
                  {{ serial }}
                </div>
              </div>
            </div>

            <div>
              <div class="flex items-baseline gap-1.5">
                <span class="text-[11px] opacity-90">还有</span>
                <span class="ylf-dreamy-display text-4xl leading-none tabular-nums sm:text-5xl">{{ daysLeft ?? '—' }}</span>
                <span class="text-[11px] opacity-90">天晴空</span>
              </div>
              <div class="ylf-pass-meter mt-2.5" role="presentation">
                <span :style="{ width: `${progress * 100}%` }" />
              </div>
              <div class="mt-1.5 flex justify-between text-[10.5px] opacity-85">
                <span>{{ cycle === 'year' ? '年付会员' : '月付会员' }}</span>
                <span class="tabular-nums">至 {{ expire }}</span>
              </div>
            </div>

            <ul class="flex items-center justify-between gap-1" aria-label="已点亮的会员权益">
              <li
                v-for="(perk, i) in PERKS"
                :key="perk.label"
                class="ylf-pass-perk flex flex-col items-center gap-1 text-[10px]"
                :style="{ '--i': i }"
              >
                <span class="inline-flex size-7 items-center justify-center rounded-full">
                  <Icon :name="perk.icon" class="size-3.5" />
                </span>
                {{ perk.label }}
              </li>
            </ul>
          </div>
        </div>
      </div>
    </component>
  </div>
</template>

<style scoped>
.ylf-pass-stage {
  /* 翻面用对称缓动：转到 90°（侧立）恰好在一半时长，两面的可见性就在这一刻交换 */
  --flip-duration: 640ms;
  --flip-half: 320ms;
  --flip-ease: cubic-bezier(0.65, 0, 0.35, 1);

  perspective: 1100px;
  width: 100%;
}

.ylf-pass-tilt {
  display: block;
  width: 100%;
  aspect-ratio: 1.6 / 1;
  border-radius: 1.5rem;
  transform: rotateX(var(--rx)) rotateY(var(--ry));
  transform-style: preserve-3d;
  transition: transform 520ms var(--ylf-ease-spring);
  -webkit-tap-highlight-color: transparent;
}

.is-tilting .ylf-pass-tilt {
  transition-duration: 90ms;
  transition-timing-function: linear;
}

.ylf-pass-tilt:focus-visible {
  outline: 2px solid var(--ylf-ring);
  outline-offset: 4px;
}

.ylf-pass-flipper {
  position: relative;
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
  transition: transform var(--flip-duration) var(--flip-ease);
  will-change: transform;
}

.ylf-pass-flipper.is-flipped {
  transform: rotateY(180deg);
}

/* 翻面时卡片先被轻轻拿起、落下时微微一压，用独立的 scale 属性，不打断 rotateY */
.ylf-pass-flipper.is-flipping {
  animation: ylf-pass-lift var(--flip-duration) var(--ylf-ease-standard);
}

@keyframes ylf-pass-lift {
  0% {
    scale: 1;
  }
  45% {
    scale: 1.06;
  }
  86% {
    scale: 0.985;
  }
  100% {
    scale: 1;
  }
}

/* 旋转期间每帧都要重算毛玻璃和投影，这里换成等效的半透明实底、关掉投影与漂浮 */
.is-flipping .ylf-pass-strip,
.is-flipping .ylf-pass-tile,
.is-flipping .ylf-pass-lock-label {
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.is-flipping .ylf-pass-strip {
  background: rgba(12, 32, 70, 0.46);
}

.is-flipping .ylf-pass-tile {
  background: rgba(255, 255, 255, 0.36);
}

.is-flipping .ylf-pass-cloud {
  filter: none;
  animation-play-state: paused;
}

.is-flipping .ylf-pass-glare {
  opacity: 0;
}

.ylf-pass-face {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: 1.5rem;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  box-shadow:
    0 30px 60px -20px rgba(40, 70, 140, 0.55),
    inset 0 0 0 1.5px rgba(255, 255, 255, 0.6);
  transition: box-shadow 300ms ease;
}

.is-tilting .ylf-pass-face {
  box-shadow:
    calc((var(--px) - 0.5) * -28px) calc(26px + (var(--py) - 0.5) * -16px) 60px -18px rgba(40, 70, 140, 0.6),
    inset 0 0 0 1.5px rgba(255, 255, 255, 0.65);
}

.ylf-pass-back {
  transform: rotateY(180deg);
}

/* 正面里的毛玻璃和漂浮云会单独合成，backface-visibility 挡不住它们；
   翻到一半（侧立时）再切换两面的可见性，背面就不会透出正面的云 */
.ylf-pass-front,
.ylf-pass-back {
  transition:
    box-shadow 300ms ease,
    visibility 0s linear var(--flip-half);
}

.ylf-pass-back,
.is-flipped .ylf-pass-front {
  visibility: hidden;
}

.is-flipped .ylf-pass-back {
  visibility: visible;
}

.ylf-pass-fade {
  background: linear-gradient(180deg, transparent 44%, rgba(8, 32, 74, 0.46) 100%);
}

.ylf-pass-shadow {
  text-shadow: 0 1px 6px rgba(0, 40, 90, 0.4);
}

.ylf-pass-tile {
  background: rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.5);
}

.ylf-pass-hint {
  background: rgba(12, 32, 70, 0.28);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4);
  opacity: 0.85;
  transition: opacity 200ms ease;
}

.group\/pass:hover .ylf-pass-hint {
  opacity: 1;
}

.ylf-pass-strip {
  background: rgba(12, 32, 70, 0.34);
  backdrop-filter: blur(12px) saturate(150%);
  -webkit-backdrop-filter: blur(12px) saturate(150%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.38);
  text-shadow:
    0 1px 4px rgba(0, 30, 70, 0.55),
    0 1px 12px rgba(0, 30, 70, 0.4);
}

/* 虹彩高光：一圈柔光 + 一道淡彩虹，位置跟随指针；静止时几乎看不见 */
.ylf-pass-glare {
  background:
    radial-gradient(
      circle at calc(var(--px) * 100%) calc(var(--py) * 100%),
      rgba(255, 255, 255, 0.42),
      transparent 42%
    ),
    linear-gradient(
      calc(110deg + (var(--px) - 0.5) * 40deg),
      transparent 30%,
      rgba(125, 211, 252, 0.28) 42%,
      rgba(196, 181, 253, 0.26) 50%,
      rgba(251, 182, 206, 0.24) 58%,
      transparent 70%
    );
  background-size:
    100% 100%,
    220% 220%;
  background-position:
    0 0,
    calc(var(--px) * 100%) calc(var(--py) * 100%);
  mix-blend-mode: soft-light;
  opacity: 0;
  transition: opacity 320ms ease;
}

.is-tilting .ylf-pass-glare {
  opacity: 1;
}

/* 未开通：云层 */
.ylf-pass-lock {
  background: linear-gradient(180deg, rgba(20, 50, 100, 0.06), rgba(20, 40, 80, 0.22));
}

.ylf-pass-bank {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 62%;
  transition: translate 640ms var(--ylf-ease-spring);
}

.ylf-pass-bank--left {
  left: 0;
}

.ylf-pass-bank--right {
  right: 0;
}

/* 卡面上的云：外层负责视差和漂浮，CuteCloud 自己负责 Q 弹（scale），三者互不覆盖 */
.ylf-pass-cloud {
  position: absolute;
  display: block;
  translate: calc((var(--px) - 0.5) * var(--depth) * -1px) calc((var(--py) - 0.5) * var(--depth) * -0.6px);
  transition: translate 560ms var(--ylf-ease-spring);
  filter: drop-shadow(0 6px 10px rgba(20, 50, 110, 0.18));
  pointer-events: none;
}

.is-tilting .ylf-pass-cloud {
  transition-duration: 140ms;
  transition-timing-function: linear;
}

.ylf-pass-cloud.is-float {
  animation: ylf-pass-float 6s ease-in-out infinite;
}

.ylf-pass-cloud.is-float-1 {
  animation-duration: 7.4s;
  animation-delay: -2s;
}

.ylf-pass-cloud.is-float-2 {
  animation-duration: 9s;
  animation-delay: -4s;
}

.ylf-pass-puff {
  filter: drop-shadow(0 8px 14px rgba(20, 50, 110, 0.22));
}

@keyframes ylf-pass-float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-4px);
  }
}

/* 戳云冒出的小星星 */
.ylf-pass-sparkle {
  position: absolute;
  color: #fde047;
  filter: drop-shadow(0 1px 3px rgba(180, 100, 0, 0.45));
  pointer-events: none;
  translate: -50% -50%;
  animation: ylf-pass-sparkle 900ms var(--ylf-ease-standard) forwards;
}

@keyframes ylf-pass-sparkle {
  from {
    opacity: 0;
    transform: translateY(0) scale(0.4) rotate(-20deg);
  }
  25% {
    opacity: 1;
    transform: translateY(-10px) scale(1.15) rotate(0deg);
  }
  to {
    opacity: 0;
    transform: translateY(-30px) scale(0.8) rotate(16deg);
  }
}

.group\/pass:is(:hover, :focus-visible) .ylf-pass-bank--left {
  translate: -26% 0;
}

.group\/pass:is(:hover, :focus-visible) .ylf-pass-bank--right {
  translate: 26% 0;
}

.ylf-pass-key {
  color: #f59e0b;
  background: rgba(255, 255, 255, 0.92);
  box-shadow:
    0 10px 24px -10px rgba(245, 158, 11, 0.7),
    0 0 0 6px rgba(255, 255, 255, 0.24);
  transition:
    scale 520ms var(--ylf-ease-spring),
    rotate 520ms var(--ylf-ease-spring);
}

.group\/pass:is(:hover, :focus-visible) .ylf-pass-key {
  scale: 1.08;
  rotate: 45deg;
}

.ylf-pass-lock-label {
  background: rgba(12, 36, 80, 0.42);
  backdrop-filter: blur(10px) saturate(140%);
  -webkit-backdrop-filter: blur(10px) saturate(140%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.3);
}

.ylf-pass-lock-title,
.ylf-pass-lock-sub {
  color: #fff;
  text-shadow: 0 1px 8px rgba(10, 40, 90, 0.55);
}

.ylf-pass-lock-sub {
  opacity: 0.88;
}

/* 背面 */
.ylf-pass-back-sky {
  background:
    radial-gradient(70% 90% at 85% 10%, rgba(255, 214, 120, 0.45), transparent 60%),
    linear-gradient(150deg, #1d4ed8 0%, #0284c7 48%, #22b8cf 100%);
}

.dark .ylf-pass-back-sky {
  background:
    radial-gradient(70% 90% at 85% 10%, rgba(251, 146, 60, 0.4), transparent 60%),
    linear-gradient(150deg, #1e2a5e 0%, #4338ca 50%, #9d4edd 100%);
}

.ylf-pass-back {
  text-shadow: 0 1px 6px rgba(0, 30, 70, 0.35);
}

.ylf-pass-meter {
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.24);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
}

.ylf-pass-meter > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #fde68a, #fff);
  box-shadow: 0 0 10px rgba(255, 236, 170, 0.8);
  transform-origin: left;
}

.is-flipped .ylf-pass-meter > span {
  animation: ylf-pass-fill 900ms var(--ylf-ease-spring) calc(var(--flip-half) + 160ms) backwards;
}

.ylf-pass-perk > span {
  background: rgba(255, 255, 255, 0.2);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.36);
}

.is-flipped .ylf-pass-perk {
  animation: ylf-pass-perk 520ms var(--ylf-ease-spring) calc(var(--flip-half) + 200ms + var(--i) * 50ms) backwards;
}

@keyframes ylf-pass-fill {
  from {
    transform: scaleX(0);
  }
}

@keyframes ylf-pass-perk {
  from {
    opacity: 0;
    translate: 0 6px;
  }
}

.is-static .ylf-pass-tilt {
  cursor: default;
}

@media (prefers-reduced-motion: reduce) {
  .ylf-pass-tilt,
  .ylf-pass-flipper,
  .ylf-pass-bank,
  .ylf-pass-key,
  .ylf-pass-cloud {
    transition: none;
  }

  .ylf-pass-cloud.is-float,
  .ylf-pass-sparkle {
    animation: none;
  }

  .is-flipped .ylf-pass-meter > span,
  .is-flipped .ylf-pass-perk {
    animation: none;
  }

  .ylf-pass-front,
  .ylf-pass-back {
    transition: none;
  }
}
</style>

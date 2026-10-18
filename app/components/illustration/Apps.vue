<script setup lang="ts">
/**
 * 「云乐坊 APPs」插画：一部手机不断放飞应用气球。
 *
 * 每隔一会儿就有一个应用图标拴着细线从屏幕里飘出去；点气球会「啵」地炸开，
 * 点手机会立刻多放一个。画面离开视口时暂停放飞，减少动态效果时只留几只静止的气球。
 */
const APPS = [
  { icon: 'i-lucide-cloud', color: 'var(--ylf-palette-blue)' },
  { icon: 'i-lucide-music', color: 'var(--ylf-palette-pink)' },
  { icon: 'i-lucide-palette', color: 'var(--ylf-palette-coral)' },
  { icon: 'i-lucide-gamepad-2', color: 'var(--ylf-palette-green)' },
  { icon: 'i-lucide-sun', color: 'var(--ylf-palette-sun)' },
  { icon: 'i-lucide-sparkles', color: 'var(--ylf-palette-cyan)' },
]

interface Balloon { id: number, app: typeof APPS[number], drift: number, popped: boolean }

const balloons = shallowRef<Balloon[]>([])
const reducedMotion = usePreferredReducedMotion()
let seed = 0
let nextApp = 0

function release() {
  const app = APPS[nextApp++ % APPS.length]!
  balloons.value = [...balloons.value, { id: ++seed, app, drift: (Math.random() - 0.5) * 2, popped: false }].slice(-8)
}

function pop(balloon: Balloon) {
  balloons.value = balloons.value.map(item => item.id === balloon.id ? { ...item, popped: true } : item)
}

function remove(balloon: Balloon) {
  balloons.value = balloons.value.filter(item => item.id !== balloon.id)
}

const frame = shallowRef<{ root: HTMLElement | null } | null>(null)
const visible = shallowRef(false)
useIntersectionObserver(() => frame.value?.root ?? null, ([entry]) => {
  visible.value = entry?.isIntersecting ?? false
})

const { pause, resume } = useIntervalFn(release, 1600, { immediate: false })
watch([visible, reducedMotion], ([isVisible, motion]) => {
  if (isVisible && motion !== 'reduce')
    resume()
  else
    pause()
}, { immediate: true })

onMounted(() => {
  // 减少动态效果时只摆三只静止的气球
  if (reducedMotion.value === 'reduce')
    balloons.value = APPS.slice(0, 3).map((app, index) => ({ id: ++seed, app, drift: index - 1, popped: false }))
  else
    release()
})
</script>

<template>
  <IllustrationFrame ref="frame" tone="dawn">
    <div class="apps">
      <CuteCloud shape="long" class="apps__cloud apps__cloud--left" />
      <CuteCloud shape="small" class="apps__cloud apps__cloud--right" />

      <div class="apps__stage">
        <span
          v-for="balloon in balloons"
          :key="balloon.id"
          class="apps__balloon"
          :class="{ 'is-popped': balloon.popped, 'is-still': reducedMotion === 'reduce' }"
          :style="{ '--drift': balloon.drift, '--c': balloon.app.color }"
          @animationend.self="remove(balloon)"
        >
          <span class="apps__string" />
          <button
            type="button"
            class="apps__icon"
            tabindex="-1"
            @click.stop="pop(balloon)"
            @animationend="balloon.popped && remove(balloon)"
          >
            <Icon :name="balloon.app.icon" class="apps__glyph" />
          </button>
          <span v-if="balloon.popped" class="apps__burst" />
        </span>

        <button type="button" class="apps__phone" tabindex="-1" @click="release">
          <span class="apps__notch" />
          <span class="apps__grid">
            <span
              v-for="(app, index) in APPS"
              :key="app.icon"
              class="apps__app"
              :style="{ '--c': app.color, '--n': index }"
            >
              <Icon :name="app.icon" class="apps__glyph" />
            </span>
          </span>
          <span class="apps__dock" />
        </button>
      </div>

      <CuteCloud shape="round" face mood="happy" class="apps__cloud apps__cloud--front" />
    </div>
  </IllustrationFrame>
</template>

<style scoped>
.apps {
  position: absolute;
  inset: 0;
}

.apps__cloud {
  position: absolute;
  translate: calc(var(--px, 0) * var(--d) * 14px) calc(var(--py, 0) * var(--d) * 8px);
  transition: translate 900ms var(--ylf-ease-standard);
  filter: drop-shadow(0 6px 10px rgb(30 80 150 / 18%));
}

.apps__cloud--left {
  --d: 0.4;

  bottom: 4cqh;
  left: -8cqw;
  width: 42cqw;
}

.apps__cloud--right {
  --d: 0.2;

  top: 14cqh;
  right: 12cqw;
  width: 14cqw;
  opacity: 0.8;
}

.apps__cloud--front {
  --d: 1.1;

  right: 6cqw;
  bottom: -5cqh;
  z-index: 4;
  width: 22cqw;
  animation: ylf-bob 5s ease-in-out infinite;
}

.apps__stage {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: end center;
}

.apps__phone {
  position: relative;
  z-index: 2;
  display: flex;
  height: 82cqh;
  aspect-ratio: 9 / 17;
  flex-direction: column;
  align-items: center;
  margin-bottom: -10cqh;
  border: 1.2cqh solid #1d2a44;
  border-bottom: 0;
  border-radius: 6cqh 6cqh 0 0;
  padding: 3cqh 2.4cqh 0;
  background: linear-gradient(170deg, #eaf4ff, #fff);
  box-shadow: 0 -1cqh 6cqh -2cqh rgb(15 55 114 / 40%);
  cursor: pointer;
  transform: perspective(900px) rotateY(calc(var(--px, 0) * 8deg));
  transition:
    transform 700ms var(--ylf-ease-standard),
    scale var(--ylf-duration-slow) var(--ylf-ease-spring);
}

.dark .apps__phone {
  background: linear-gradient(170deg, #273452, #1a2338);
}

.apps__phone:active {
  scale: 0.97;
}

.apps__notch {
  width: 30%;
  height: 2.2cqh;
  margin-bottom: 4cqh;
  border-radius: 99px;
  background: #1d2a44;
}

.apps__grid {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(3, 1fr);
  gap: 3cqh;
}

.apps__app {
  display: grid;
  aspect-ratio: 1;
  place-items: center;
  border-radius: 28%;
  color: #fff;
  background: var(--c);
  box-shadow: inset 0 -0.6cqh 0 rgb(0 0 0 / 12%);
  animation: apps-wiggle 4.8s var(--ylf-ease-standard) calc(var(--n) * 0.4s) infinite;
}

.apps__dock {
  width: 80%;
  height: 7cqh;
  margin-top: auto;
  margin-bottom: 4cqh;
  border-radius: 2.5cqh;
  background: rgb(15 55 114 / 8%);
}

.apps__glyph {
  width: 52%;
  height: 52%;
}

/* 气球：从手机顶部升起，左右轻摆，飘出画面后自行移除 */
.apps__balloon {
  position: absolute;
  z-index: 3;
  bottom: 62cqh;
  left: 50%;
  display: grid;
  width: 9cqh;
  justify-items: center;
  margin-left: -4.5cqh;
  animation: apps-rise 6.4s cubic-bezier(0.3, 0.1, 0.6, 1) forwards;
}

.apps__balloon.is-still {
  bottom: calc(64cqh + var(--drift) * 6cqh);
  translate: calc(var(--drift) * 14cqh) 0;
  animation: none;
}

.apps__icon {
  order: -1;
  display: grid;
  width: 100%;
  aspect-ratio: 1;
  place-items: center;
  border-radius: 32%;
  padding: 0;
  color: #fff;
  background: var(--c);
  box-shadow:
    inset 0 -0.7cqh 0 rgb(0 0 0 / 14%),
    0 1.2cqh 2.4cqh -1cqh rgb(15 55 114 / 40%);
  cursor: pointer;
  transition: scale var(--ylf-duration-slow) var(--ylf-ease-spring);
}

.apps__icon:hover {
  scale: 1.12;
}

.apps__string {
  width: 1px;
  height: 7cqh;
  background: rgb(15 55 114 / 35%);
}

.apps__balloon.is-popped .apps__icon {
  animation: apps-pop 360ms var(--ylf-ease-standard) forwards;
}

.apps__balloon.is-popped .apps__string {
  opacity: 0;
}

.apps__burst {
  position: absolute;
  top: 4.5cqh;
  left: 50%;
  width: 16cqh;
  aspect-ratio: 1;
  border-radius: 50%;
  background:
    radial-gradient(circle, transparent 52%, var(--c) 54% 58%, transparent 60%),
    conic-gradient(
      from 0deg,
      var(--c) 0 6%,
      transparent 6% 16%,
      var(--c) 16% 22%,
      transparent 22% 34%,
      var(--c) 34% 40%,
      transparent 40% 52%,
      var(--c) 52% 58%,
      transparent 58% 70%,
      var(--c) 70% 76%,
      transparent 76% 88%,
      var(--c) 88% 94%,
      transparent 94%
    );
  mask: radial-gradient(circle, transparent 30%, #000 32%);
  translate: -50% -50%;
  animation: apps-burst 360ms var(--ylf-ease-standard) forwards;
}

@keyframes apps-burst {
  from {
    opacity: 1;
    scale: 0.4;
  }
  to {
    opacity: 0;
    scale: 1.2;
  }
}

@keyframes apps-rise {
  0% {
    opacity: 0;
    transform: translate(0, 20cqh) scale(0.6);
  }
  12% {
    opacity: 1;
    transform: translate(calc(var(--drift) * 6cqw), 0) scale(1);
  }
  50% {
    transform: translate(calc(var(--drift) * -10cqw), -45cqh) rotate(calc(var(--drift) * 8deg));
  }
  100% {
    opacity: 0.9;
    transform: translate(calc(var(--drift) * 22cqw), -110cqh) rotate(calc(var(--drift) * -6deg));
  }
}

@keyframes apps-pop {
  to {
    opacity: 0;
    scale: 1.5;
  }
}

@keyframes apps-wiggle {
  0%,
  86%,
  100% {
    rotate: 0deg;
  }
  90% {
    rotate: -8deg;
  }
  95% {
    rotate: 6deg;
  }
}
</style>

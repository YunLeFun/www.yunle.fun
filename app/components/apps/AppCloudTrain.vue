<script setup lang="ts">
import type { SsoAccountState, SsoExplorerApp } from '~/types/app-explorer'
import AppProductIcon from './AppProductIcon.vue'

const props = withDefaults(defineProps<{
  apps: SsoExplorerApp[]
  account: SsoAccountState
  reducedMotion?: boolean
}>(), { reducedMotion: false })
defineEmits<{ scrollToGrid: [] }>()

const station = shallowRef(0)
const wide = useMediaQuery('(min-width: 768px)')
const mounted = useMounted()
// 服务端和 hydration 首帧都先呈现一节车厢，再按真实视口展开。
const carriageCount = computed(() => mounted.value && wide.value ? 3 : 1)
const stationCount = computed(() => Math.ceil(props.apps.length / carriageCount.value))
const carriages = computed(() => props.apps.slice(station.value * carriageCount.value, (station.value + 1) * carriageCount.value))
const host = useTemplateRef('host')
const hovered = shallowRef(false)
const focused = shallowRef(false)
const paused = shallowRef(false)
const inView = shallowRef(false)
const visibility = useDocumentVisibility()
const running = computed(() => !props.reducedMotion && !paused.value && !hovered.value && !focused.value && inView.value && visibility.value === 'visible')

useIntersectionObserver(host, ([entry]) => {
  inView.value = Boolean(entry?.isIntersecting)
}, { threshold: 0.15 })

function move(direction: number) {
  if (stationCount.value)
    station.value = (station.value + direction + stationCount.value) % stationCount.value
}

const { pause: pauseTimer, resume: resumeTimer } = useIntervalFn(() => move(1), 6500, { immediate: false })
watch([running, stationCount], ([run, count]) => {
  if (run && count > 1)
    resumeTimer()
  else
    pauseTimer()
}, { immediate: true })
watch(carriageCount, () => {
  station.value = 0
})
watch(stationCount, (count) => {
  station.value = Math.min(station.value, Math.max(0, count - 1))
})

function leaveFocus(event: FocusEvent) {
  focused.value = Boolean(host.value?.contains(event.relatedTarget as Node | null))
}
</script>

<template>
  <section
    ref="host"
    class="cloud-train"
    aria-label="云海列车，发现统一账号应用"
    aria-roledescription="轮播"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
    @focusin="focused = true"
    @focusout="leaveFocus"
  >
    <div class="cloud-train__view">
      <!-- 这个边界也是风景中列车的投影位置：网页链接与画在云层之间的车厢一一重合。 -->
      <div class="cloud-train__bounds" :data-cloud-coaches="carriages.length">
        <div class="cloud-train__consist" :aria-live="running ? 'off' : 'polite'">
          <a
            v-for="app in carriages"
            :key="app.appId"
            class="cloud-train__carriage"
            :href="app.origin"
            :title="`${app.name} · ${app.description}`"
            target="_blank"
            rel="noopener noreferrer"
            :data-app-id="app.appId"
          >
            <span class="cloud-train__plate">
              <AppProductIcon :app="app" class="cloud-train__badge" />
              <span class="cloud-train__name">{{ app.name }}</span>
            </span>
            <span class="sr-only">，{{ app.description }}，在新标签页打开</span>
          </a>
          <span class="cloud-train__engine" aria-hidden="true" />
        </div>
      </div>
    </div>

    <footer class="cloud-train__footer">
      <div class="cloud-train__controls" role="group" aria-label="列车轮播控制">
        <button type="button" aria-label="上一班应用" :disabled="stationCount < 2" @click="move(-1)">
          <Icon name="i-lucide-chevron-left" />
        </button>
        <span class="cloud-train__position">{{ station + 1 }} / {{ stationCount || 1 }}</span>
        <button type="button" aria-label="下一班应用" :disabled="stationCount < 2" @click="move(1)">
          <Icon name="i-lucide-chevron-right" />
        </button>
        <button v-if="!reducedMotion && stationCount > 1" type="button" :aria-label="paused ? '播放列车轮播' : '暂停列车轮播'" :aria-pressed="paused" @click="paused = !paused">
          <Icon :name="paused ? 'i-lucide-play' : 'i-lucide-pause'" />
        </button>
      </div>
      <div class="cloud-train__links">
        <NuxtLink :to="account.to" class="cloud-train__ticket">
          <Icon name="i-lucide-ticket" aria-hidden="true" />
          {{ account.status === 'authenticated' ? account.displayName : '统一账号' }}
        </NuxtLink>
        <button class="cloud-train__all" type="button" @click="$emit('scrollToGrid')">
          浏览全部应用 <Icon name="i-lucide-arrow-down" aria-hidden="true" />
        </button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.cloud-train {
  --pitch: clamp(7.7rem, 9vw, 8.5rem);
  color: var(--ui-text);
}
.cloud-train__view {
  position: relative;
  height: clamp(14rem, 23vw, 21rem);
}
.cloud-train__bounds {
  position: absolute;
  top: 50%;
  left: 56%;
  width: max-content;
  transform: translate(-50%, -50%);
}
.cloud-train__consist {
  display: flex;
  /* Match the shader's rail grade; the unskewed bounds are its reference point. */
  transform: skewY(-2deg);
  transform-origin: left bottom;
}
.cloud-train__carriage,
.cloud-train__engine {
  position: relative;
  width: var(--pitch);
  aspect-ratio: 128 / 56;
}
/* Static first paint and no-WebGL share the exact artwork used by the cloud renderer. */
.cloud-train__carriage::before,
.cloud-train__engine::before {
  position: absolute;
  inset: 0;
  content: '';
  background: url('~/assets/art/cloud-train.svg') 0 0 / 200% 100%;
  opacity: 0.84;
}
.cloud-train__engine::before {
  background-position: right;
}
.cloud-train__consist::before {
  position: absolute;
  content: '';
  top: 100%;
  inset-inline: -65vw;
  height: 2px;
  background: var(--cloud-rail);
  opacity: 0.42;
}
.cloud-train__consist::after {
  position: absolute;
  z-index: 1;
  inset: -20% -16% -50%;
  content: '';
  pointer-events: none;
  background:
    radial-gradient(ellipse 30% 46% at 87% 54%, color-mix(in srgb, var(--cloud-light) 70%, transparent), transparent),
    radial-gradient(ellipse 38% 26% at 15% 75%, color-mix(in srgb, var(--cloud-shade) 80%, transparent), transparent);
}
main:has([data-interactive-rail='true']) .cloud-train__consist::after,
main:has([data-interactive-rail='true']) .cloud-train__consist::before,
main:has([data-interactive-rail='true']) .cloud-train__engine::before,
main:has([data-interactive-rail='true']) .cloud-train__carriage::before {
  display: none;
}
.cloud-train__plate {
  position: absolute;
  z-index: 2;
  inset-inline: 5%;
  top: 66%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.22em;
  transform: translateY(-50%);
  color: #fff6da;
  font-family: var(--ylf-font-body);
  font-size: 0.8125rem;
  font-weight: 550;
  line-height: 1.1;
  text-shadow:
    0 1px 2px #203e4d,
    0 0 3px #203e4d;
}
.cloud-train__plate .cloud-train__badge {
  --app-icon-size: 1em;
  font-size: inherit;
  box-shadow: none;
  border-radius: 2px;
  background: #eee4cf;
  text-shadow: none;
}
.cloud-train__plate .cloud-train__badge::after {
  border: 0;
}
.cloud-train__name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.cloud-train__carriage:is(:hover, :focus-visible) .cloud-train__name {
  color: white;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.cloud-train :is(button, a):focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 3px;
  border-radius: 3px;
}
.cloud-train__footer,
.cloud-train__controls,
.cloud-train__links,
.cloud-train__links > * {
  display: flex;
  align-items: center;
}
.cloud-train__footer {
  position: relative;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.25rem 1rem;
  font-size: 0.8rem;
}
.cloud-train__controls button,
.cloud-train__links > * {
  min-height: 44px;
  justify-content: center;
}
.cloud-train__links {
  gap: clamp(0.8rem, 2vw, 2rem);
}
.cloud-train__links > * {
  gap: 0.45rem;
}
.cloud-train__controls button {
  display: grid;
  min-width: 44px;
  place-items: center;
}
.cloud-train__controls button:is(:hover, :focus-visible) {
  color: var(--ui-primary);
}
.cloud-train__controls button:disabled {
  opacity: 0.4;
}
.cloud-train__links > :hover {
  text-decoration: underline;
}
.cloud-train__position {
  font-variant-numeric: tabular-nums;
  min-width: 3.1em;
  text-align: center;
}
@media (max-width: 767px) {
  .cloud-train {
    --pitch: 7.8rem;
  }
  .cloud-train__bounds {
    left: 50%;
  }
  .cloud-train__view {
    height: 14rem;
  }
  .cloud-train__footer {
    font-size: 0.75rem;
  }
  .cloud-train__links {
    margin-left: auto;
  }
}
</style>

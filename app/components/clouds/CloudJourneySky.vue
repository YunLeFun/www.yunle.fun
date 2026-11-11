<script setup lang="ts">
import type { CloudTrainBounds } from '~/utils/cloud-sea'
import { getCloudJourneyPath } from '~/utils/cloud-journey'
import CloudSeaCanvas from './CloudSeaCanvas.vue'

// 位于默认布局内，两个页面只更新边界；Canvas、相机时间和远处列车始终是同一份。
const route = useRoute()
const journeyPath = computed(() => getCloudJourneyPath(route.path))
const enabled = computed(() => journeyPath.value !== null)
const root = useTemplateRef('root')
const anchor = shallowRef<HTMLElement | null>(null)
const coachAnchor = shallowRef<HTMLElement | null>(null)
const train = shallowRef<CloudTrainBounds | null>(null)
const height = shallowRef<number>()
const visible = useElementVisibility(root)
const { traveling } = useCloudTravel()
const { active: entering, begin, finish } = useHomeEntrance()
const ready = shallowRef(false)
const nuxtApp = useNuxtApp()

function measure() {
  const target = anchor.value
  const parent = root.value?.parentElement
  if (!target || !parent) {
    train.value = null
    return
  }
  const scene = parent.getBoundingClientRect()
  height.value = Math.ceil(target.getBoundingClientRect().bottom - scene.top + 32)
  const bounds = coachAnchor.value?.getBoundingClientRect()
  const coaches = Number(coachAnchor.value?.dataset.cloudCoaches)
  train.value = bounds && coaches > 0
    ? { left: bounds.left - scene.left, bottom: bounds.bottom - scene.top, pitch: bounds.width / (coaches + 1), coaches }
    : null
}

async function locate() {
  await nextTick()
  anchor.value = enabled.value ? document.querySelector<HTMLElement>(`[data-cloud-journey="${journeyPath.value}"]`) : null
  coachAnchor.value = anchor.value?.querySelector<HTMLElement>('[data-cloud-coaches]') ?? null
  measure()
  if (ready.value && journeyPath.value === '/')
    begin()
  else if (journeyPath.value !== '/')
    finish()
}

function onReady() {
  ready.value = true
  if (journeyPath.value === '/')
    begin()
}

onMounted(locate)
watch(journeyPath, locate, { flush: 'post' })
useResizeObserver([anchor, coachAnchor], measure)
useEventListener('resize', measure, { passive: true })
const removePageHook = nuxtApp.hook('page:finish', locate)
onBeforeUnmount(removePageHook)
</script>

<template>
  <div
    v-show="enabled"
    ref="root"
    class="cloud-journey"
    :style="height ? { height: `${height}px` } : undefined"
    aria-hidden="true"
  >
    <CloudSeaCanvas :train="train" :playing="enabled" :paused="!visible" :traveling="traveling" :entering="entering" @ready="onReady" />
  </div>
</template>

<style scoped>
.cloud-journey {
  position: absolute;
  z-index: 0;
  inset: 0 0 auto;
  height: clamp(42rem, 65vw, 52rem);
  overflow: clip;
  pointer-events: none;
  background: linear-gradient(180deg, var(--cloud-sky-top), var(--cloud-sky-horizon));
  mask-image: linear-gradient(#000 0 78%, transparent 100%);
}
</style>

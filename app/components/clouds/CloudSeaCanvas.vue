<script setup lang="ts">
import type { CloudTrainBounds } from '~/utils/cloud-sea'
import grainUrl from '~/assets/art/cloud-grain.png?url'
import trainUrl from '~/assets/art/cloud-train.svg?url'
import { CLOUD_TRAVEL_DURATION } from '~/composables/useCloudTravel'
import { HOME_ENTRANCE_DURATION } from '~/composables/useHomeEntrance'
import { createCloudSea } from '~/utils/cloud-sea'

const props = defineProps<{
  train: CloudTrainBounds | null
  playing: boolean
  paused: boolean
  traveling: boolean
  entering: boolean
}>()
const emit = defineEmits<{ ready: [] }>()
const canvas = useTemplateRef('canvas')
const available = shallowRef(false)
const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const visibility = useDocumentVisibility()
let renderer: ReturnType<typeof createCloudSea> = null
const canPaint = computed(() => props.playing && !props.paused && visibility.value === 'visible')
let frame = 0
let lastPaint = 0
let sceneTime = 0
let entranceStart = -Infinity
let travelStart = -Infinity
let attempted = false
let size = { width: 0, height: 0 }
let layoutDirty = true
let mounted = false
let pointer: [number, number] = [0, 0]
const camera: [number, number] = [0, 0]

function stop() {
  cancelAnimationFrame(frame)
  frame = 0
}

function requestPaint() {
  if (!frame && renderer && canPaint.value)
    frame = requestAnimationFrame(draw)
}

function draw(now: number) {
  frame = 0
  if (!renderer || !canPaint.value)
    return
  const still = reducedMotion.value
  const dt = lastPaint ? Math.min(now - lastPaint, 60) : 0
  const travel = !still && props.traveling ? Math.sin(Math.PI * Math.min(1, (now - travelStart) / CLOUD_TRAVEL_DURATION)) : 0
  const entrance = !still && props.entering ? (1 - Math.min(1, (now - entranceStart) / HOME_ENTRANCE_DURATION)) ** 3 : 0
  if (!still)
    sceneTime += dt * (1 + travel * 1.2)
  // Keep the camera's easing in real time as the display refresh rate changes.
  const follow = 1 - Math.exp(-dt / 800)
  camera[0] = still ? 0 : camera[0] + (pointer[0] - camera[0]) * follow
  camera[1] = still ? 0 : camera[1] + (pointer[1] - camera[1]) * follow
  lastPaint = now
  if (layoutDirty) {
    // Resizing clears the drawing buffer. Resize and paint in the same frame.
    renderer.setLayout(size.width, size.height, props.train)
    layoutDirty = false
  }
  renderer.draw(sceneTime, entrance * 0.08 + travel * 0.015, camera, travel)
  available.value = true
  if (!still)
    requestPaint()
}

function redraw() {
  stop()
  requestPaint()
}

function syncLayout() {
  layoutDirty = true
  redraw()
}

async function initialize() {
  if (!mounted || attempted || !canPaint.value)
    return
  attempted = true
  try {
    const art = new Image()
    const grain = new Image()
    art.src = trainUrl
    grain.src = grainUrl
    await Promise.all([art.decode(), grain.decode()])
    if (mounted && canvas.value) {
      renderer = createCloudSea(canvas.value, art, grain)
      if (!size.width)
        size = canvas.value.getBoundingClientRect()
      syncLayout()
    }
  }
  catch {
    // The static scenery and native carriage links are already visible.
  }
  finally {
    if (mounted)
      emit('ready')
  }
}

watch(() => props.entering, (active) => {
  if (active)
    entranceStart = performance.now()
})
watch(() => props.traveling, (active) => {
  if (active)
    travelStart = performance.now()
})
watch([canPaint, reducedMotion], () => {
  lastPaint = 0
  void initialize()
  redraw()
})
watch(() => props.train, syncLayout)
useResizeObserver(canvas, ([entry]) => {
  if (entry) {
    size = entry.contentRect
    syncLayout()
  }
})
useMutationObserver(import.meta.client ? document.documentElement : undefined, () => {
  renderer?.updatePalette()
  redraw()
}, { attributes: true, attributeFilter: ['class', 'data-sky-phase'] })
useEventListener('pointermove', (event: PointerEvent) => {
  if (event.pointerType === 'mouse' && canPaint.value && !reducedMotion.value)
    pointer = [event.clientX / window.innerWidth * 2 - 1, event.clientY / window.innerHeight * 2 - 1]
}, { passive: true })
useEventListener('blur', () => {
  pointer = [0, 0]
})

onMounted(() => {
  mounted = true
  void initialize()
})

function contextLost(event: Event) {
  event.preventDefault()
  stop()
  renderer = null
  available.value = false
}

function contextRestored() {
  attempted = false
  void initialize()
}

onBeforeUnmount(() => {
  mounted = false
  stop()
  renderer?.dispose()
})
</script>

<template>
  <div class="cloud-sea" :data-renderer="available ? 'webgl' : 'fallback'" :data-interactive-rail="available && !!train" aria-hidden="true">
    <canvas ref="canvas" :class="{ 'is-ready': available }" @webglcontextlost="contextLost" @webglcontextrestored="contextRestored" />
  </div>
</template>

<style scoped>
.cloud-sea {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse 46% 20% at 4% 74%, var(--cloud-light), transparent),
    radial-gradient(ellipse 49% 18% at 84% 75%, var(--cloud-light), transparent),
    radial-gradient(ellipse 55% 20% at 40% 85%, var(--cloud-shade), transparent),
    linear-gradient(0deg, var(--cloud-light), transparent 46%);
}
.cloud-sea canvas {
  display: block;
  width: 100%;
  height: 100%;
  opacity: 0;
}
.cloud-sea canvas.is-ready {
  opacity: 1;
}
</style>

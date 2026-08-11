<script setup lang="ts">
import { CropIcon, ZoomInIcon, ZoomOutIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Slider } from '@/components/ui/slider'

const props = defineProps<{
  file: File | null
  maxSize?: number // 输出最大尺寸（px），默认 512
  quality?: number // JPEG 压缩质量 0-1，默认 0.85
}>()

const emit = defineEmits<{
  (e: 'confirm', file: File): void
  (e: 'cancel'): void
}>()

const open = defineModel<boolean>('open', { default: false })

const canvasRef = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)

const maxOutput = computed(() => props.maxSize || 512)
const outputQuality = computed(() => props.quality || 0.85)

// 图片和裁剪状态
const img = ref<HTMLImageElement | null>(null)
const imgLoaded = ref(false)

// 图片在画布中的渲染参数
const renderState = reactive({
  imgX: 0,
  imgY: 0,
  imgW: 0,
  imgH: 0,
  scale: 1,
})

// 裁剪框参数（正方形）
const crop = reactive({
  x: 0,
  y: 0,
  size: 0,
})

// 画布尺寸
const canvasW = ref(400)
const canvasH = ref(400)

// 拖拽状态
const dragging = ref<'crop' | 'nw' | 'ne' | 'sw' | 'se' | null>(null)
const dragStart = reactive({ x: 0, y: 0, cropX: 0, cropY: 0, cropSize: 0 })

// 缩放
const zoomLevel = ref(1)
const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
const zoomModel = computed({
  get: () => [zoomLevel.value],
  set: (value: number[]) => onZoom(value[0] ?? 1),
})

watch(() => props.file, (file, _previousFile, onCleanup) => {
  if (!file)
    return

  imgLoaded.value = false
  const image = new Image()
  const objectUrl = URL.createObjectURL(file)
  onCleanup(() => URL.revokeObjectURL(objectUrl))

  image.onload = () => {
    img.value = image
    imgLoaded.value = true
    nextTick(() => initLayout())
  }
  image.src = objectUrl
}, { immediate: true })

watch(open, (v) => {
  if (v && img.value && imgLoaded.value) {
    nextTick(() => initLayout())
  }
})

function initLayout() {
  const canvas = canvasRef.value
  const container = containerRef.value
  if (!canvas || !container || !img.value)
    return

  const rect = container.getBoundingClientRect()
  canvasW.value = Math.floor(rect.width)
  canvasH.value = Math.floor(rect.height)
  canvas.width = canvasW.value
  canvas.height = canvasH.value

  const image = img.value
  const iw = image.naturalWidth
  const ih = image.naturalHeight

  // 缩放图片适应画布（留 padding）
  const padding = 40
  const availW = canvasW.value - padding * 2
  const availH = canvasH.value - padding * 2
  const fitScale = Math.min(availW / iw, availH / ih, 1)

  renderState.imgW = Math.round(iw * fitScale)
  renderState.imgH = Math.round(ih * fitScale)
  renderState.imgX = Math.round((canvasW.value - renderState.imgW) / 2)
  renderState.imgY = Math.round((canvasH.value - renderState.imgH) / 2)
  renderState.scale = fitScale

  // 初始裁剪框：居中最大正方形
  const minDim = Math.min(renderState.imgW, renderState.imgH)
  crop.size = Math.round(minDim * 0.8)
  crop.x = Math.round(renderState.imgX + (renderState.imgW - crop.size) / 2)
  crop.y = Math.round(renderState.imgY + (renderState.imgH - crop.size) / 2)

  zoomLevel.value = 1
  draw()
}

function draw() {
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx || !img.value)
    return

  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // 画棋盘格背景（表示透明）
  const tileSize = 10
  for (let y = 0; y < canvas.height; y += tileSize) {
    for (let x = 0; x < canvas.width; x += tileSize) {
      ctx.fillStyle = ((x / tileSize + y / tileSize) % 2 === 0) ? '#f0f0f0' : '#e0e0e0'
      ctx.fillRect(x, y, tileSize, tileSize)
    }
  }

  // 绘制图片
  ctx.drawImage(
    img.value,
    renderState.imgX,
    renderState.imgY,
    renderState.imgW,
    renderState.imgH,
  )

  // 半透明遮罩（裁剪框外部）
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
  // 上
  ctx.fillRect(0, 0, canvas.width, crop.y)
  // 下
  ctx.fillRect(0, crop.y + crop.size, canvas.width, canvas.height - crop.y - crop.size)
  // 左
  ctx.fillRect(0, crop.y, crop.x, crop.size)
  // 右
  ctx.fillRect(crop.x + crop.size, crop.y, canvas.width - crop.x - crop.size, crop.size)

  // 裁剪框边框
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.strokeRect(crop.x, crop.y, crop.size, crop.size)

  // 三等分参考线
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
  ctx.lineWidth = 1
  const third = crop.size / 3
  for (let i = 1; i <= 2; i++) {
    ctx.beginPath()
    ctx.moveTo(crop.x + third * i, crop.y)
    ctx.lineTo(crop.x + third * i, crop.y + crop.size)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(crop.x, crop.y + third * i)
    ctx.lineTo(crop.x + crop.size, crop.y + third * i)
    ctx.stroke()
  }

  // 四角拖拽手柄
  const handleSize = 10
  ctx.fillStyle = '#ffffff'
  const corners = [
    [crop.x, crop.y],
    [crop.x + crop.size, crop.y],
    [crop.x, crop.y + crop.size],
    [crop.x + crop.size, crop.y + crop.size],
  ]
  for (const corner of corners) {
    if (!corner)
      continue
    const [cx, cy] = corner as [number, number]
    ctx.fillRect(cx - handleSize / 2, cy - handleSize / 2, handleSize, handleSize)
  }
}

function getCanvasPos(e: MouseEvent | TouchEvent) {
  const canvas = canvasRef.value
  if (!canvas)
    return { x: 0, y: 0 }
  const rect = canvas.getBoundingClientRect()
  const clientX = 'touches' in e ? e.touches[0]!.clientX : e.clientX
  const clientY = 'touches' in e ? e.touches[0]!.clientY : e.clientY
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  }
}

function getHitZone(x: number, y: number): typeof dragging.value {
  const handleR = 14
  const corners: [number, number, typeof dragging.value][] = [
    [crop.x, crop.y, 'nw'],
    [crop.x + crop.size, crop.y, 'ne'],
    [crop.x, crop.y + crop.size, 'sw'],
    [crop.x + crop.size, crop.y + crop.size, 'se'],
  ]
  for (const [cx, cy, zone] of corners) {
    if (Math.abs(x - cx) < handleR && Math.abs(y - cy) < handleR)
      return zone
  }
  if (x >= crop.x && x <= crop.x + crop.size && y >= crop.y && y <= crop.y + crop.size) {
    return 'crop'
  }
  return null
}

function onPointerDown(e: MouseEvent | TouchEvent) {
  const pos = getCanvasPos(e)
  const zone = getHitZone(pos.x, pos.y)
  if (!zone)
    return

  e.preventDefault()
  dragging.value = zone
  dragStart.x = pos.x
  dragStart.y = pos.y
  dragStart.cropX = crop.x
  dragStart.cropY = crop.y
  dragStart.cropSize = crop.size
}

function onPointerMove(e: MouseEvent | TouchEvent) {
  if (!dragging.value) {
    // 更新光标
    const pos = getCanvasPos(e)
    const zone = getHitZone(pos.x, pos.y)
    const canvas = canvasRef.value
    if (canvas) {
      if (zone === 'nw' || zone === 'se')
        canvas.style.cursor = 'nwse-resize'
      else if (zone === 'ne' || zone === 'sw')
        canvas.style.cursor = 'nesw-resize'
      else if (zone === 'crop')
        canvas.style.cursor = 'move'
      else canvas.style.cursor = 'default'
    }
    return
  }

  e.preventDefault()
  const pos = getCanvasPos(e)
  const dx = pos.x - dragStart.x
  const dy = pos.y - dragStart.y
  const MIN_CROP = 50

  if (dragging.value === 'crop') {
    // 移动裁剪框
    let nx = dragStart.cropX + dx
    let ny = dragStart.cropY + dy
    // 限制在图片范围内
    nx = Math.max(renderState.imgX, Math.min(nx, renderState.imgX + renderState.imgW - crop.size))
    ny = Math.max(renderState.imgY, Math.min(ny, renderState.imgY + renderState.imgH - crop.size))
    crop.x = nx
    crop.y = ny
  }
  else {
    // 调整大小（保持正方形）
    const delta = (Math.abs(dx) > Math.abs(dy)) ? dx : dy

    let newSize = dragStart.cropSize
    let newX = dragStart.cropX
    let newY = dragStart.cropY

    if (dragging.value === 'se') {
      newSize = Math.max(MIN_CROP, dragStart.cropSize + delta)
    }
    else if (dragging.value === 'nw') {
      newSize = Math.max(MIN_CROP, dragStart.cropSize - delta)
      newX = dragStart.cropX + dragStart.cropSize - newSize
      newY = dragStart.cropY + dragStart.cropSize - newSize
    }
    else if (dragging.value === 'ne') {
      newSize = Math.max(MIN_CROP, dragStart.cropSize + dx)
      newY = dragStart.cropY + dragStart.cropSize - newSize
    }
    else if (dragging.value === 'sw') {
      newSize = Math.max(MIN_CROP, dragStart.cropSize + dy)
      newX = dragStart.cropX + dragStart.cropSize - newSize
    }

    // 限制在图片范围内
    if (newX < renderState.imgX) {
      newSize -= (renderState.imgX - newX)
      newX = renderState.imgX
    }
    if (newY < renderState.imgY) {
      newSize -= (renderState.imgY - newY)
      newY = renderState.imgY
    }
    if (newX + newSize > renderState.imgX + renderState.imgW) {
      newSize = renderState.imgX + renderState.imgW - newX
    }
    if (newY + newSize > renderState.imgY + renderState.imgH) {
      newSize = renderState.imgY + renderState.imgH - newY
    }

    newSize = Math.max(MIN_CROP, newSize)
    crop.size = newSize
    crop.x = newX
    crop.y = newY
  }

  draw()
}

function onPointerUp() {
  dragging.value = null
}

function onZoom(val: number) {
  const oldZoom = zoomLevel.value
  zoomLevel.value = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, val))

  if (!img.value)
    return

  const ratio = zoomLevel.value / oldZoom
  const image = img.value

  // 以画布中心为缩放锚点
  const centerX = canvasW.value / 2
  const centerY = canvasH.value / 2

  const newW = Math.round(renderState.imgW * ratio)
  const newH = Math.round(renderState.imgH * ratio)
  const newX = Math.round(centerX - (centerX - renderState.imgX) * ratio)
  const newY = Math.round(centerY - (centerY - renderState.imgY) * ratio)

  renderState.imgW = newW
  renderState.imgH = newH
  renderState.imgX = newX
  renderState.imgY = newY
  renderState.scale = newW / image.naturalWidth

  // 确保裁剪框仍在图片范围内
  crop.x = Math.max(renderState.imgX, Math.min(crop.x, renderState.imgX + renderState.imgW - crop.size))
  crop.y = Math.max(renderState.imgY, Math.min(crop.y, renderState.imgY + renderState.imgH - crop.size))

  draw()
}

function onCropKeydown(event: KeyboardEvent) {
  if (!img.value)
    return

  const step = event.shiftKey ? 10 : 2
  const minX = renderState.imgX
  const minY = renderState.imgY
  const maxX = renderState.imgX + renderState.imgW - crop.size
  const maxY = renderState.imgY + renderState.imgH - crop.size

  if (event.key === 'ArrowLeft')
    crop.x = Math.max(minX, crop.x - step)
  else if (event.key === 'ArrowRight')
    crop.x = Math.min(maxX, crop.x + step)
  else if (event.key === 'ArrowUp')
    crop.y = Math.max(minY, crop.y - step)
  else if (event.key === 'ArrowDown')
    crop.y = Math.min(maxY, crop.y + step)
  else
    return

  event.preventDefault()
  draw()
}

async function confirm() {
  if (!img.value)
    return

  const image = img.value
  // 计算在原图上的裁剪区域
  const srcX = (crop.x - renderState.imgX) / renderState.scale
  const srcY = (crop.y - renderState.imgY) / renderState.scale
  const srcSize = crop.size / renderState.scale

  // 输出尺寸：不超过 maxOutput，也不超过原图裁剪区域尺寸
  const outputSize = Math.min(maxOutput.value, Math.round(srcSize))

  const offscreen = document.createElement('canvas')
  offscreen.width = outputSize
  offscreen.height = outputSize
  const ctx = offscreen.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, srcX, srcY, srcSize, srcSize, 0, 0, outputSize, outputSize)

  const blob = await new Promise<Blob | null>(resolve =>
    offscreen.toBlob(resolve, 'image/jpeg', outputQuality.value),
  )

  if (!blob)
    return

  const file = new File([blob], `avatar_${Date.now()}.jpg`, { type: 'image/jpeg' })
  emit('confirm', file)
  open.value = false
}

function cancel() {
  emit('cancel')
  open.value = false
}

function handleOpenChange(value: boolean) {
  if (!value && open.value)
    emit('cancel')
  open.value = value
}

// 预览尺寸信息
const previewInfo = computed(() => {
  if (!img.value)
    return null
  const srcSize = Math.round(crop.size / renderState.scale)
  const outputSize = Math.min(maxOutput.value, srcSize)
  return { srcSize, outputSize }
})

onMounted(() => {
  window.addEventListener('mousemove', onPointerMove)
  window.addEventListener('mouseup', onPointerUp)
  window.addEventListener('touchmove', onPointerMove, { passive: false })
  window.addEventListener('touchend', onPointerUp)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onPointerMove)
  window.removeEventListener('mouseup', onPointerUp)
  window.removeEventListener('touchmove', onPointerMove)
  window.removeEventListener('touchend', onPointerUp)
})
</script>

<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogContent
      class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
      :show-close-button="false"
    >
      <DialogHeader>
        <DialogTitle>裁剪头像</DialogTitle>
        <DialogDescription>
          拖动方框选择头像范围；键盘可用方向键移动，按住 Shift 加速
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-4 px-5 pb-6 sm:px-6">
        <div
          ref="containerRef"
          class="relative h-[min(55vh,22.5rem)] min-h-64 w-full touch-none select-none overflow-hidden rounded-xl border border-border bg-muted"
        >
          <canvas
            ref="canvasRef"
            aria-label="头像裁剪区域"
            aria-describedby="avatar-cropper-keyboard-help"
            class="absolute inset-0 size-full touch-none"
            tabindex="0"
            @mousedown="onPointerDown"
            @touchstart.prevent="onPointerDown"
            @keydown="onCropKeydown"
          />
        </div>

        <p id="avatar-cropper-keyboard-help" class="sr-only">
          使用方向键移动裁剪区域，按住 Shift 键可加快移动。
        </p>

        <div class="flex items-center gap-3">
          <ZoomOutIcon class="size-4 shrink-0 text-muted-foreground" />
          <Slider
            v-model="zoomModel"
            aria-label="缩放头像"
            :min="MIN_ZOOM"
            :max="MAX_ZOOM"
            :step="0.05"
            class="flex-1"
          />
          <ZoomInIcon class="size-4 shrink-0 text-muted-foreground" />
        </div>

        <p v-if="previewInfo" class="text-center text-xs text-muted-foreground">
          裁剪 {{ previewInfo.srcSize }}×{{ previewInfo.srcSize }}px · 输出 {{ previewInfo.outputSize }}×{{ previewInfo.outputSize }}px
        </p>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="cancel">
          取消
        </Button>
        <Button @click="confirm">
          <CropIcon data-icon="inline-start" />
          确认裁剪
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

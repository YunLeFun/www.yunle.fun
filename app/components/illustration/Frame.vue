<script setup lang="ts">
import { useSkyParallax } from '~/composables/useSkyParallax'

/**
 * 交互插画的画框：晴空 / 黄昏背景 + 随时辰的天色层 + 鼠标视差变量（--px / --py）+ 容器查询单位。
 *
 * 场景内部用 cqw / cqh 排版，画框是什么比例都能自适应；离开视口时暂停所有循环动画，
 * 系统要求减少动态效果时只保留静态画面。
 * 场景里的每朵 CuteCloud 都可以戳：点在云的实色部分上会 Q 弹一下，并记进云朵收藏。
 */
const props = withDefaults(defineProps<{
  /** 天色：day 晴空、dawn 清晨暖光 */
  tone?: 'day' | 'dawn'
}>(), {
  tone: 'day',
})

const root = shallowRef<HTMLElement | null>(null)
useSkyParallax(root)

const visible = shallowRef(true)
useIntersectionObserver(root, ([entry]) => {
  visible.value = entry?.isIntersecting ?? true
})

const { collect } = useCloudCollection()
function poke(event: MouseEvent) {
  const cloud = (event.target as Element | null)?.closest('.cute-cloud')
  if (cloud)
    collect(cloud)
}

defineExpose({ root })
</script>

<template>
  <div
    ref="root"
    class="ylf-illustration ylf-sky-phase"
    :data-tone="props.tone"
    :data-paused="visible ? undefined : ''"
    aria-hidden="true"
    @click="poke"
  >
    <span class="ylf-illustration__sun" />
    <slot :visible="visible" />
  </div>
</template>

<style scoped>
.ylf-illustration {
  --sky-top: #3b8be4;
  --sky-mid: #8cc8f3;
  --sky-low: #e3f1fc;
  --sun: rgb(255 248 220 / 85%);

  position: relative;
  isolation: isolate;
  overflow: hidden;
  width: 100%;
  height: 100%;
  min-height: 10rem;
  background: linear-gradient(170deg, var(--sky-top) 0%, var(--sky-mid) 55%, var(--sky-low) 100%);
  container-type: size;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.ylf-illustration[data-tone='dawn'] {
  --sky-top: #5b9be6;
  --sky-mid: #bcd9f2;
  --sky-low: #ffe9cf;
}

.dark .ylf-illustration,
.dark .ylf-illustration[data-tone='dawn'] {
  --sky-top: #2f3568;
  --sky-mid: #8a6aa8;
  --sky-low: #f2a98a;
  --sun: rgb(255 214 170 / 70%);
}

.ylf-illustration__sun {
  position: absolute;
  z-index: 0;
  top: -18cqh;
  right: -8cqw;
  width: 60cqw;
  aspect-ratio: 1;
  border-radius: 50%;
  background: radial-gradient(circle, var(--sun), transparent 62%);
  pointer-events: none;
}

/* 云只在画出来的实色部分接收点击（svg 外框的透明处仍然穿透）；烟囱冒出的小云太快，不算 */
.ylf-illustration :deep(.cute-cloud:not(.studio__puff) > *) {
  cursor: pointer;
  pointer-events: visiblePainted;
}

/* 离开视口或减少动态效果时，场景里的循环动画全部停下 */
.ylf-illustration[data-paused] :deep(*) {
  animation-play-state: paused !important;
}

@media (prefers-reduced-motion: reduce) {
  .ylf-illustration :deep(*) {
    animation: none !important;
  }
}
</style>

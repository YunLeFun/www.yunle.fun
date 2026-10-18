<script setup lang="ts">
/**
 * 数字滚动：数值变化时从旧值平滑滚到新值，常用于余额、关注数等统计。
 *
 * 系统要求减少动态效果时直接显示目标值；始终使用等宽数字，避免滚动时抖动。
 * 读屏只朗读最终值，不播报滚动过程。
 */
const props = withDefaults(defineProps<{
  value: number
  /** 滚动时长（毫秒） */
  duration?: number
}>(), {
  duration: 900,
})

const reducedMotion = usePreferredReducedMotion()
const source = computed(() => props.value)
const animated = useTransition(source, {
  duration: computed(() => reducedMotion.value === 'reduce' ? 0 : props.duration),
  easing: [0.22, 1, 0.36, 1],
})

const display = computed(() => Math.round(animated.value).toLocaleString('zh-CN'))
</script>

<template>
  <span class="tabular-nums">
    <span aria-hidden="true">{{ display }}</span>
    <span class="sr-only">{{ value.toLocaleString('zh-CN') }}</span>
  </span>
</template>

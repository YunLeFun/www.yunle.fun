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
  /** 自定义格式化（如价格、小数点数）；默认取整并按中文千分位显示 */
  format?: (value: number) => string
}>(), {
  duration: 900,
})

const reducedMotion = usePreferredReducedMotion()
const source = computed(() => props.value)
const animated = useTransition(source, {
  duration: computed(() => reducedMotion.value === 'reduce' ? 0 : props.duration),
  easing: [0.22, 1, 0.36, 1],
})

function formatValue(value: number) {
  return props.format ? props.format(value) : Math.round(value).toLocaleString('zh-CN')
}
const display = computed(() => formatValue(animated.value))
</script>

<template>
  <span class="tabular-nums">
    <span aria-hidden="true">{{ display }}</span>
    <span class="sr-only">{{ formatValue(value) }}</span>
  </span>
</template>

<script setup lang="ts">
/**
 * 小标签（eyebrow）。统一渲染为「图标 + 文案」的胶囊样式。
 *
 * label 可携带前导 emoji（如 "🚀 开发者平台"），组件会自动把 emoji 映射为对应
 * 的 Lucide 图标并渲染图标 + 去掉 emoji 的文案；也可通过 icon 显式指定图标。
 */
const props = defineProps<{
  /** 文案，可包含前导 emoji（将自动映射为图标） */
  label?: string
  /** 显式指定图标，优先级高于 emoji 推断 */
  icon?: string
}>()

/** emoji -> Lucide 图标映射 */
const EMOJI_ICON: Record<string, string> = {
  '🎈': 'i-lucide-party-popper',
  '🛍️': 'i-lucide-shopping-bag',
  '🚀': 'i-lucide-rocket',
  '✨': 'i-lucide-sparkles',
  '🧰': 'i-lucide-wrench',
  '☁️': 'i-lucide-cloud',
  '⚡': 'i-lucide-zap',
  '💎': 'i-lucide-gem',
  '💰': 'i-lucide-coins',
  '🗞️': 'i-lucide-newspaper',
  '🧾': 'i-lucide-scroll-text',
  '📥': 'i-lucide-download',
  '📋': 'i-lucide-clipboard-list',
  '❓': 'i-lucide-circle-help',
}

const DEFAULT_ICON = 'i-lucide-sparkles'

const parsed = computed(() => {
  const raw = (props.label ?? '').trim()
  // 仅匹配前导 emoji（含变体选择符 U+FE0F），避免 .* 回溯
  const emoji = raw.match(/^\p{Extended_Pictographic}️?/u)?.[0]
  if (emoji)
    return { icon: props.icon || EMOJI_ICON[emoji] || DEFAULT_ICON, text: raw.slice(emoji.length).trim() }
  return { icon: props.icon || DEFAULT_ICON, text: raw }
})
</script>

<template>
  <span class="ylf-eyebrow">
    <Icon
      :name="parsed.icon"
      class="size-3.5 shrink-0"
    />
    <span><slot>{{ parsed.text }}</slot></span>
  </span>
</template>

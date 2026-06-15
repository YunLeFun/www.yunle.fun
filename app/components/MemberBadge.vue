<script setup lang="ts">
/**
 * 会员标识徽章 —— 「云」朵图标 + 品牌渐变。
 *
 * 云乐坊会员的统一视觉标识，替代此前通用的皇冠图标。
 * 作为单一来源在个人中心、钱包、用户菜单等处复用，
 * 若需换成「云」字徽章，只改此处即可全站生效。
 */
type MarkSize = 'xs' | 'sm' | 'md'

const props = withDefaults(defineProps<{
  /** 尺寸 */
  size?: MarkSize
  /** 到期时间戳（ms），传入则附带「至 …」 */
  expireAt?: number | null
  /** 文案，默认「会员」；传空串则只显示到期信息 */
  label?: string
}>(), {
  size: 'sm',
  expireAt: null,
  label: '会员',
})

const SIZE: Record<MarkSize, { wrap: string, icon: string }> = {
  xs: { wrap: 'h-5 gap-1 ps-1.5 pe-2 text-[11px]', icon: 'size-3' },
  sm: { wrap: 'h-6 gap-1 ps-1.5 pe-2.5 text-xs', icon: 'size-3.5' },
  md: { wrap: 'h-7 gap-1.5 ps-2 pe-3 text-sm', icon: 'size-4' },
}
const cls = computed(() => SIZE[props.size])

function formatExpire(ts: number) {
  return new Date(ts).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}
</script>

<template>
  <span
    class="ylf-member-mark inline-flex items-center rounded-full font-semibold leading-none"
    :class="cls.wrap"
  >
    <UIcon name="i-lucide-cloud" :class="cls.icon" />
    <span v-if="label">{{ label }}</span>
    <span
      v-if="expireAt"
      class="font-medium"
      :class="{ 'opacity-85': label }"
    >{{ label ? '· ' : '' }}至 {{ formatExpire(expireAt) }}</span>
  </span>
</template>

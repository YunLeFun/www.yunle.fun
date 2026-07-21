<script setup lang="ts">
/**
 * 带会员角标的头像。
 *
 * 会员用户的头像右下角叠加「云」朵渐变角标，
 * 导航栏、用户菜单、个人中心统一复用，让会员身份一眼可见。
 */
type AvatarSize = '3xs' | '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl'

const props = withDefaults(defineProps<{
  src?: string | null
  alt?: string
  size?: AvatarSize
  isMember?: boolean
  /** 角标描边色，应与所在背景一致（默认页面背景） */
  ringClass?: string
}>(), {
  size: 'md',
  isMember: false,
  ringClass: 'ring-(color:--ui-bg)',
})

const resolvedSrc = useAvatarUrl(() => props.src)

const CORNER: Record<AvatarSize, string> = {
  '3xs': 'size-2 -right-0.5 -bottom-0.5',
  '2xs': 'size-2.5 -right-0.5 -bottom-0.5',
  'xs': 'size-3 -right-0.5 -bottom-0.5',
  'sm': 'size-3.5 -right-0.5 -bottom-0.5',
  'md': 'size-4 -right-0.5 -bottom-0.5',
  'lg': 'size-[1.125rem] -right-0.5 -bottom-0.5',
  'xl': 'size-5 -right-1 -bottom-1',
  '2xl': 'size-[1.375rem] -right-1 -bottom-1',
  '3xl': 'size-6 -right-1 -bottom-1',
}
const ICON: Record<AvatarSize, string> = {
  '3xs': 'size-1.5',
  '2xs': 'size-1.5',
  'xs': 'size-2',
  'sm': 'size-2.5',
  'md': 'size-2.5',
  'lg': 'size-3',
  'xl': 'size-3',
  '2xl': 'size-3.5',
  '3xl': 'size-4',
}
</script>

<template>
  <div class="relative inline-flex shrink-0">
    <UAvatar
      :src="resolvedSrc"
      :alt="alt"
      :size="size"
    />
    <span
      v-if="isMember"
      class="ylf-member-mark absolute flex items-center justify-center rounded-full ring-2"
      :class="[CORNER[size], ringClass]"
      title="云乐坊会员"
      aria-label="云乐坊会员"
    >
      <UIcon name="i-lucide-cloud" :class="ICON[size]" />
    </span>
  </div>
</template>

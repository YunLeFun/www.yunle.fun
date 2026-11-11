<script setup lang="ts">
import type { CloudAchievement } from '~/types/cloud-achievements'
import { CloudIcon } from '@lucide/vue'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import AchievementCloud from '~/components/achievements/AchievementCloud.vue'

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
  /** Explicit owner cosmetic; never inferred from the viewer's account. */
  equippedCloud?: CloudAchievement | null
  /** 角标描边色，应与所在背景一致（默认页面背景） */
  ringClass?: string
}>(), {
  size: 'md',
  isMember: false,
  ringClass: 'ring-(color:--ui-bg)',
})

const resolvedSrc = useAvatarUrl(() => props.src)
const fallbackText = computed(() => {
  const label = props.alt?.trim()
  return label ? Array.from(label).slice(0, 1).join('').toUpperCase() : '云'
})

const AVATAR: Record<AvatarSize, string> = {
  '3xs': '1.25rem',
  '2xs': '1.5rem',
  'xs': '1.75rem',
  'sm': '2rem',
  'md': '2.25rem',
  'lg': '2.5rem',
  'xl': '3rem',
  '2xl': '4rem',
  '3xl': '5rem',
}
const visibleCloud = computed(() => props.equippedCloud?.unlockedAt != null ? props.equippedCloud : null)

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
  <div class="member-avatar relative inline-flex shrink-0" :class="{ 'member-avatar--cloud': visibleCloud }" :style="{ '--avatar-base-size': AVATAR[size] }">
    <span class="relative inline-flex">
      <Avatar :style="{ width: 'var(--avatar-render-size)', height: 'var(--avatar-render-size)' }">
        <AvatarImage
          v-if="resolvedSrc"
          :src="resolvedSrc"
          :alt="alt || ''"
        />
        <AvatarFallback class="bg-secondary font-heading font-semibold text-primary">
          {{ fallbackText }}
        </AvatarFallback>
      </Avatar>
      <span
        v-if="isMember"
        class="ylf-member-mark absolute flex items-center justify-center rounded-full ring-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        :class="[CORNER[size], ringClass]"
        title="云乐坊会员"
        aria-label="云乐坊会员"
        role="img"
        tabindex="0"
      >
        <CloudIcon :class="ICON[size]" />
      </span>
    </span>
    <span
      v-if="visibleCloud"
      class="member-avatar__cloud"
      role="img"
      :title="`佩戴云朵：${visibleCloud.name}`"
      :aria-label="`佩戴云朵：${visibleCloud.name}`"
      :data-cloud-effect="visibleCloud.effect"
    >
      <AchievementCloud :effect="visibleCloud.effect" />
    </span>
  </div>
</template>

<style scoped>
.member-avatar {
  --avatar-render-size: var(--avatar-size, var(--avatar-base-size));
}
.member-avatar--cloud {
  padding-inline-end: calc(var(--avatar-render-size) * 0.28);
}
.member-avatar__cloud {
  position: absolute;
  z-index: 1;
  top: calc(var(--avatar-render-size) * -0.2);
  left: calc(var(--avatar-render-size) * 0.64);
  width: calc(var(--avatar-render-size) * 0.66);
  height: calc(var(--avatar-render-size) * 0.66);
  pointer-events: none;
}
.member-avatar__cloud :deep(.achievement-cloud) {
  min-height: 0;
}
</style>

<script setup lang="ts">
import type { YlfAccentTone, YlfColorAppearance } from '@/types/design'
import YlfBadge from '@yunlefun/vue/components/YlfBadge.vue'
import { computed } from 'vue'

type BadgeColor = 'primary' | 'neutral' | 'error' | 'success' | 'warning' | 'info'

const props = withDefaults(defineProps<{
  color?: BadgeColor
  icon?: string
  label?: string
  size?: 'xs' | 'sm' | 'md'
  tone?: YlfAccentTone
  variant?: 'solid' | 'soft' | 'subtle' | 'outline'
}>(), {
  color: 'primary',
  variant: 'soft',
})

const statusByColor: Partial<Record<BadgeColor, 'danger' | 'success' | 'warning' | 'info'>> = {
  error: 'danger',
  success: 'success',
  warning: 'warning',
  info: 'info',
}
const status = computed(() => statusByColor[props.color])
const badgeVariant = computed(() => status.value || (props.color === 'neutral' && !props.tone ? 'neutral' : 'accent'))
const designAppearance = computed<YlfColorAppearance>(() =>
  props.variant === 'solid' ? 'solid' : props.variant === 'outline' ? 'outline' : 'soft',
)
</script>

<template>
  <YlfBadge
    data-slot="badge"
    :variant="badgeVariant"
    :tone="tone"
    :appearance="designAppearance"
    :data-ylf-tone="!status ? tone || 'blue' : undefined"
    :data-ylf-status="status"
    :class="{ 'app-badge--neutral-outline': badgeVariant === 'neutral' && variant === 'outline' }"
  >
    <Icon v-if="icon" :name="icon" class="size-3" aria-hidden="true" data-icon="inline-start" />
    <slot>{{ label }}</slot>
  </YlfBadge>
</template>

<style scoped>
.app-badge--neutral-outline {
  background: transparent;
  border-color: var(--ylf-c-border-strong);
}
</style>

<script setup lang="ts">
import type { BadgeVariants } from '@/components/ui/badge'
import type { YlfAccentTone, YlfColorAppearance } from '@/types/design'
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'

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
const badgeVariant = computed<BadgeVariants['variant']>(() => {
  if (props.color === 'error')
    return 'destructive'
  if (props.variant === 'outline')
    return 'outline'
  if (props.variant === 'solid' && props.color === 'primary')
    return 'default'
  return 'secondary'
})
const status = computed(() => statusByColor[props.color])
const designAppearance = computed<YlfColorAppearance | undefined>(() => {
  if (!props.tone && !status.value)
    return undefined
  return props.variant === 'solid' ? 'solid' : props.variant === 'outline' ? 'outline' : 'soft'
})
</script>

<template>
  <Badge
    :variant="badgeVariant"
    :data-ylf-tone="!status && designAppearance ? tone : undefined"
    :data-ylf-status="designAppearance ? status : undefined"
    :data-ylf-appearance="designAppearance"
  >
    <Icon v-if="icon" :name="icon" data-icon="inline-start" />
    <slot>{{ label }}</slot>
  </Badge>
</template>

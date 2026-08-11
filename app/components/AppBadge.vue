<script setup lang="ts">
import type { BadgeVariants } from '@/components/ui/badge'
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'

const props = withDefaults(defineProps<{
  color?: 'primary' | 'neutral' | 'error' | 'success' | 'warning'
  icon?: string
  label?: string
  size?: 'xs' | 'sm' | 'md'
  variant?: 'solid' | 'soft' | 'subtle' | 'outline'
}>(), {
  color: 'primary',
  variant: 'soft',
})

const badgeVariant = computed<BadgeVariants['variant']>(() => {
  if (props.color === 'error')
    return 'destructive'
  if (props.variant === 'outline')
    return 'outline'
  if (props.variant === 'solid' && props.color === 'primary')
    return 'default'
  return 'secondary'
})
</script>

<template>
  <Badge :variant="badgeVariant">
    <Icon v-if="icon" :name="icon" data-icon="inline-start" />
    <slot>{{ label }}</slot>
  </Badge>
</template>

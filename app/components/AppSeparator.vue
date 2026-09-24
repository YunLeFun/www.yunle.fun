<script setup lang="ts">
import type { SeparatorProps } from 'reka-ui'
import type { YlfAccentTone } from '@/types/design'
import { Separator } from '@/components/ui/separator'

withDefaults(defineProps<SeparatorProps & {
  variant?: 'neutral' | 'brand' | 'accent'
  tone?: YlfAccentTone
}>(), {
  orientation: 'horizontal',
  decorative: true,
  variant: 'neutral',
})
</script>

<template>
  <Separator
    :orientation="orientation"
    :decorative="decorative"
    :data-ylf-tone="variant === 'accent' ? (tone || 'blue') : undefined"
    :data-ylf-variant="variant"
  />
</template>

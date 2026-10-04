<script setup lang="ts">
import type { SeparatorProps } from 'reka-ui'
import type { YlfAccentTone } from '@/types/design'
import YlfSeparator from '@yunlefun/vue/components/YlfSeparator.vue'

withDefaults(defineProps<SeparatorProps & {
  variant?: 'neutral' | 'brand' | 'accent' | 'spectrum'
  tone?: YlfAccentTone
}>(), {
  orientation: 'horizontal',
  decorative: true,
  variant: 'neutral',
})
</script>

<template>
  <YlfSeparator
    data-slot="separator"
    :orientation="orientation"
    :decorative="decorative"
    :variant="variant"
    :tone="tone"
    :data-ylf-tone="variant === 'accent' ? (tone || 'blue') : undefined"
    :data-ylf-variant="variant"
  />
</template>

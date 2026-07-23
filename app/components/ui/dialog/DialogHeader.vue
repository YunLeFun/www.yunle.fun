<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    data-slot="dialog-header"
    :class="cn('gap-2 px-6 pt-6 pb-4 flex flex-col', props.class)"
  >
    <slot />
  </div>
</template>

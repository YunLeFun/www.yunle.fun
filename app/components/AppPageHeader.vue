<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  class?: HTMLAttributes['class']
  description?: string
  title?: string
}>()
</script>

<template>
  <header :class="cn('flex flex-col gap-4 border-b border-border py-10 sm:py-14', props.class)">
    <div v-if="$slots.headline" class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <slot name="headline" />
    </div>
    <h1 class="font-heading text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
      <slot name="title">
        {{ title }}
      </slot>
    </h1>
    <p v-if="description" class="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
      {{ description }}
    </p>
    <slot />
  </header>
</template>

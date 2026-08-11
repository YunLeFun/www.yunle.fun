<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { cn } from '@/lib/utils'

interface HeroLink {
  class?: HTMLAttributes['class']
  color?: 'primary' | 'neutral' | 'error' | 'success' | 'warning'
  icon?: string
  label: string
  rel?: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  target?: string
  to: RouteLocationRaw
  trailing?: boolean
  trailingIcon?: string
  variant?: 'solid' | 'soft' | 'subtle' | 'outline' | 'ghost' | 'link'
}

const props = defineProps<{
  class?: HTMLAttributes['class']
  description?: string
  links?: HeroLink[]
  title?: string
}>()
</script>

<template>
  <section :class="cn('relative overflow-hidden py-16 sm:py-24', props.class)">
    <slot name="top" />
    <AppContainer class="relative flex flex-col items-center gap-6 text-center">
      <slot name="headline" />
      <h1 class="ylf-dreamy-display max-w-4xl text-4xl leading-tight text-foreground sm:text-5xl lg:text-6xl">
        <slot name="title">
          {{ title }}
        </slot>
      </h1>
      <p v-if="description" class="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
        {{ description }}
      </p>
      <div v-if="links?.length" class="flex flex-wrap justify-center gap-3">
        <AppButton v-for="link in links" :key="String(link.to)" v-bind="link" />
      </div>
      <div v-if="$slots.default" class="mt-4 w-full text-left">
        <slot />
      </div>
    </AppContainer>
  </section>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { cn } from '@/lib/utils'

interface CtaLink {
  class?: string
  color?: 'primary' | 'neutral' | 'error' | 'success' | 'warning'
  icon?: string
  label: string
  target?: string
  to: RouteLocationRaw
  trailingIcon?: string
  variant?: 'solid' | 'soft' | 'subtle' | 'outline' | 'ghost' | 'link'
}

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  class?: HTMLAttributes['class']
  description?: string
  links?: CtaLink[]
  title?: string
  variant?: 'naked' | 'subtle'
}>()
</script>

<template>
  <section :class="cn('relative overflow-hidden rounded-3xl border border-border bg-card px-6 py-12 text-center shadow-sm sm:px-10 sm:py-16', props.class)">
    <div class="relative z-1 mx-auto flex max-w-2xl flex-col items-center gap-4">
      <h2 class="font-heading text-2xl font-semibold text-foreground sm:text-3xl">
        {{ title }}
      </h2>
      <p v-if="description" class="leading-7 text-muted-foreground">
        {{ description }}
      </p>
      <div v-if="links?.length" class="mt-2 flex flex-wrap justify-center gap-3">
        <AppButton v-for="link in links" :key="String(link.to)" v-bind="link" />
      </div>
    </div>
    <slot />
  </section>
</template>

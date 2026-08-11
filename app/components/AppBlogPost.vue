<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { cn } from '@/lib/utils'

const props = defineProps<{
  authors?: Array<{ name?: string }>
  badge?: { label?: string }
  date?: string
  description?: string
  image?: string | { src?: string, alt?: string }
  orientation?: 'horizontal' | 'vertical'
  title?: string
  to?: RouteLocationRaw
  ui?: {
    description?: HTMLAttributes['class']
  }
}>()

const imageSrc = computed(() => typeof props.image === 'string' ? props.image : props.image?.src)
const destination = computed<RouteLocationRaw>(() => props.to || '/blog')
</script>

<template>
  <NuxtLink :to="destination" class="group block h-full">
    <article class="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <img v-if="imageSrc" :src="imageSrc" :alt="typeof image === 'object' ? image.alt || title : title" class="aspect-video w-full object-cover">
      <div class="flex flex-1 flex-col gap-3 p-5">
        <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <AppBadge v-if="badge?.label" variant="subtle">
            {{ badge.label }}
          </AppBadge>
          <time v-if="date">{{ date }}</time>
        </div>
        <h2 class="font-heading text-xl font-semibold text-foreground group-hover:text-primary">
          {{ title }}
        </h2>
        <p v-if="description" :class="cn('line-clamp-2 text-sm leading-6 text-muted-foreground', ui?.description)">
          {{ description }}
        </p>
        <p v-if="authors?.length" class="mt-auto text-xs text-muted-foreground">
          {{ authors.map(author => author.name).filter(Boolean).join('、') }}
        </p>
      </div>
    </article>
  </NuxtLink>
</template>

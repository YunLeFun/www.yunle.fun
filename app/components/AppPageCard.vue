<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  class?: HTMLAttributes['class']
  description?: string
  href?: string
  icon?: string
  orientation?: 'horizontal' | 'vertical'
  spotlight?: boolean
  target?: string
  title?: string
  to?: RouteLocationRaw
  ui?: {
    leadingIcon?: HTMLAttributes['class']
  }
  variant?: 'solid' | 'outline' | 'soft' | 'subtle' | 'naked'
}>()
</script>

<template>
  <component
    :is="to ? resolveComponent('NuxtLink') : href ? 'a' : 'div'"
    :to="to"
    :href="href"
    :target="target"
    :rel="target === '_blank' ? 'noopener noreferrer' : undefined"
    :class="to || href ? 'group block' : 'contents'"
  >
    <Card
      v-bind="$attrs"
      :class="props.class"
    >
      <CardHeader v-if="icon || title || description">
        <span v-if="icon" class="ylf-icon-tile flex size-10 items-center justify-center rounded-xl">
          <Icon :name="icon" :class="cn('size-5', ui?.leadingIcon)" />
        </span>
        <CardTitle v-if="title">
          {{ title }}
        </CardTitle>
        <CardDescription v-if="description">
          {{ description }}
        </CardDescription>
      </CardHeader>
      <CardContent v-if="$slots.default" :class="title || description || icon ? undefined : 'contents'">
        <slot />
      </CardContent>
      <CardFooter v-if="$slots.footer">
        <slot name="footer" />
      </CardFooter>
    </Card>
  </component>
</template>

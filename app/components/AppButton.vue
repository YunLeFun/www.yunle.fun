<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { ButtonVariants } from '@/components/ui/button'
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

type LegacyColor = 'primary' | 'secondary' | 'neutral' | 'error' | 'success' | 'info' | 'warning'
type LegacyVariant = 'solid' | 'soft' | 'subtle' | 'outline' | 'ghost' | 'link'
type LegacySize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const props = withDefaults(defineProps<{
  block?: boolean
  color?: LegacyColor
  disabled?: boolean
  href?: string
  icon?: string
  label?: string
  loading?: boolean
  rel?: string
  size?: LegacySize
  target?: string
  to?: RouteLocationRaw
  trailing?: boolean
  trailingIcon?: string
  type?: 'button' | 'submit' | 'reset'
  variant?: LegacyVariant
}>(), {
  color: 'primary',
  size: 'md',
  type: 'button',
  variant: 'solid',
})

const isLink = computed(() => Boolean(props.to || props.href))
const endingIcon = computed(() => props.trailingIcon || (props.trailing ? props.icon : undefined))

const buttonVariant = computed<ButtonVariants['variant']>(() => {
  if (props.color === 'error')
    return 'destructive'

  if (props.variant === 'outline')
    return 'outline'
  if (props.variant === 'ghost')
    return 'ghost'
  if (props.variant === 'link')
    return 'link'
  if (props.variant === 'soft' || props.variant === 'subtle' || ['secondary', 'neutral', 'info'].includes(props.color))
    return 'secondary'

  return 'default'
})

const buttonSize = computed<ButtonVariants['size']>(() => {
  if (props.size === 'xs')
    return 'xs'
  if (props.size === 'sm')
    return 'sm'
  if (props.size === 'lg' || props.size === 'xl')
    return 'lg'
  return 'default'
})
</script>

<template>
  <Button
    :as-child="isLink"
    :variant="buttonVariant"
    :size="buttonSize"
    :type="isLink ? undefined : type"
    :disabled="disabled || loading"
    :class="block ? 'w-full' : undefined"
  >
    <NuxtLink
      v-if="to"
      :to="to"
      :target="target"
      :rel="rel"
      :aria-disabled="disabled || loading || undefined"
    >
      <Spinner v-if="loading" data-icon="inline-start" />
      <Icon v-else-if="icon && !trailing" :name="icon" data-icon="inline-start" />
      <slot>{{ label }}</slot>
      <Icon v-if="endingIcon" :name="endingIcon" data-icon="inline-end" />
    </NuxtLink>

    <a
      v-else-if="href"
      :href="href"
      :target="target"
      :rel="rel"
      :aria-disabled="disabled || loading || undefined"
    >
      <Spinner v-if="loading" data-icon="inline-start" />
      <Icon v-else-if="icon && !trailing" :name="icon" data-icon="inline-start" />
      <slot>{{ label }}</slot>
      <Icon v-if="endingIcon" :name="endingIcon" data-icon="inline-end" />
    </a>

    <template v-else>
      <Spinner v-if="loading" data-icon="inline-start" />
      <Icon v-else-if="icon && !trailing" :name="icon" data-icon="inline-start" />
      <slot>{{ label }}</slot>
      <Icon v-if="endingIcon" :name="endingIcon" data-icon="inline-end" />
    </template>
  </Button>
</template>

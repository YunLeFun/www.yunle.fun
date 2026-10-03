<script setup lang="ts">
import type { PrimitiveProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import type { ButtonVariants } from '.'
import { Primitive } from 'reka-ui'
import { computed } from 'vue'
import { cn } from '@/lib/utils'
import { buttonVariants } from '.'

interface Props extends PrimitiveProps {
  variant?: ButtonVariants['variant']
  size?: ButtonVariants['size']
  class?: HTMLAttributes['class']
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  as: 'button',
})

const isNativeButton = computed(() => props.as === 'button' && !props.asChild)

function guardActivation(event: MouseEvent) {
  if (!props.disabled)
    return

  event.preventDefault()
  event.stopImmediatePropagation()
}
</script>

<template>
  <Primitive
    data-slot="button"
    :data-variant="variant"
    :data-size="size"
    :as="as"
    :as-child="asChild"
    :disabled="isNativeButton ? disabled : undefined"
    :aria-disabled="disabled || undefined"
    :tabindex="disabled && !isNativeButton ? -1 : undefined"
    :class="cn(buttonVariants({ variant, size }), props.class)"
    @click.capture="guardActivation"
    @auxclick.capture="guardActivation"
  >
    <slot />
  </Primitive>
</template>

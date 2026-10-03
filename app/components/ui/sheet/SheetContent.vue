<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps } from 'reka-ui'

import type { HTMLAttributes } from 'vue'
import { XIcon } from '@lucide/vue'
import { reactiveOmit } from '@vueuse/core'
import {
  DialogClose,
  DialogContent,
  DialogPortal,
  useForwardPropsEmits,
} from 'reka-ui'
import { Button } from '@/components/ui/button'
import { panelSurface } from '@/components/ui/surface'
import { cn } from '@/lib/utils'
import SheetOverlay from './SheetOverlay.vue'

interface SheetContentProps extends DialogContentProps {
  class?: HTMLAttributes['class']
  side?: 'top' | 'right' | 'bottom' | 'left'
  showCloseButton?: boolean
}

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<SheetContentProps>(), {
  side: 'right',
  showCloseButton: true,
})
const emits = defineEmits<DialogContentEmits>()

// Plain utilities let callers override dimensions through cn without fighting data selectors.
const sideClasses = {
  top: 'inset-x-0 top-0 h-auto border-b',
  right: 'inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm',
  bottom: 'inset-x-0 bottom-0 h-auto border-t',
  left: 'inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm',
} satisfies Record<NonNullable<SheetContentProps['side']>, string>

const delegatedProps = reactiveOmit(props, 'class', 'side', 'showCloseButton')

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <DialogPortal>
    <SheetOverlay />
    <DialogContent
      data-slot="sheet-content"
      :data-side="side"
      :class="cn(panelSurface, 'fixed z-50 flex flex-col gap-4 max-h-dvh overflow-y-auto bg-clip-padding text-sm transition duration-200 ease-in-out data-open:animate-in data-open:fade-in-0 data-[side=bottom]:data-open:slide-in-from-bottom-10 data-[side=left]:data-open:slide-in-from-left-10 data-[side=right]:data-open:slide-in-from-right-10 data-[side=top]:data-open:slide-in-from-top-10 data-closed:animate-out data-closed:fade-out-0 data-[side=bottom]:data-closed:slide-out-to-bottom-10 data-[side=left]:data-closed:slide-out-to-left-10 data-[side=right]:data-closed:slide-out-to-right-10 data-[side=top]:data-closed:slide-out-to-top-10', sideClasses[side], props.class)"
      v-bind="{ ...$attrs, ...forwarded }"
    >
      <slot />

      <DialogClose
        v-if="showCloseButton"
        data-slot="sheet-close"
        as-child
      >
        <Button variant="ghost" class="absolute top-3 right-3 size-11 sm:size-9" size="icon-sm">
          <XIcon />
          <span class="sr-only">关闭</span>
        </Button>
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>

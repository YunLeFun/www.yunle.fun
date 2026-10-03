<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps } from 'reka-ui'

import type { HTMLAttributes } from 'vue'
import { XIcon } from '@lucide/vue'
import { reactiveOmit } from '@vueuse/core'
import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  useForwardPropsEmits,
} from 'reka-ui'
import { Button } from '@/components/ui/button'
import { panelOverlay, panelSurface } from '@/components/ui/surface'
import { cn } from '@/lib/utils'

defineOptions({
  inheritAttrs: false,
})

const props = defineProps<DialogContentProps & { class?: HTMLAttributes['class'] }>()
const emits = defineEmits<DialogContentEmits>()

const delegatedProps = reactiveOmit(props, 'class')

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <DialogPortal>
    <DialogOverlay
      data-slot="dialog-overlay"
      :class="cn(panelOverlay, 'fixed inset-0 z-50 grid items-start justify-items-center overflow-y-auto p-4 sm:p-8 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0')"
    >
      <DialogContent
        data-slot="dialog-content"
        :class="
          cn(
            panelSurface,
            'relative z-50 grid w-full max-w-lg my-auto gap-4 rounded-2xl border p-6 outline-none duration-200',
            props.class,
          )
        "
        v-bind="{ ...$attrs, ...forwarded }"
        @pointer-down-outside="(event) => {
          const originalEvent = event.detail.originalEvent;
          const target = originalEvent.target as HTMLElement;
          if (originalEvent.offsetX > target.clientWidth || originalEvent.offsetY > target.clientHeight) {
            event.preventDefault();
          }
        }"
      >
        <slot />

        <DialogClose data-slot="dialog-close" as-child>
          <Button variant="ghost" class="absolute top-3 right-3 size-11 sm:top-4 sm:right-4 sm:size-9" size="icon-sm">
            <XIcon />
            <span class="sr-only">关闭</span>
          </Button>
        </DialogClose>
      </DialogContent>
    </DialogOverlay>
  </DialogPortal>
</template>

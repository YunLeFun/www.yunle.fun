<script setup lang="ts">
import type { DropdownMenuSubTriggerProps } from 'reka-ui'

import type { HTMLAttributes } from 'vue'
import { ChevronRightIcon } from '@lucide/vue'
import { reactiveOmit } from '@vueuse/core'
import {
  DropdownMenuSubTrigger,
  useForwardProps,
} from 'reka-ui'
import { menuItem } from '@/components/ui/surface'
import { cn } from '@/lib/utils'

const props = defineProps<DropdownMenuSubTriggerProps & { class?: HTMLAttributes['class'], inset?: boolean }>()

const delegatedProps = reactiveOmit(props, 'class', 'inset')
const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <DropdownMenuSubTrigger
    data-slot="dropdown-menu-sub-trigger"
    :data-inset="inset ? '' : undefined"
    v-bind="forwardedProps"
    :class="cn(
      menuItem,
      'data-open:bg-[var(--ylf-c-brand-soft)] data-open:text-primary data-inset:pl-7 [&_svg:not([class*=size-])]:size-4 flex items-center outline-hidden select-none [&_svg]:pointer-events-none [&_svg]:shrink-0',
      props.class,
    )"
  >
    <slot />
    <ChevronRightIcon class="cn-rtl-flip ml-auto" />
  </DropdownMenuSubTrigger>
</template>

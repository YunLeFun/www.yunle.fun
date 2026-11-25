<script setup lang="ts">
import { menuSurface } from '@/components/ui/surface'

withDefaults(defineProps<{
  label: string
  align?: 'start' | 'end'
  iconOnly?: boolean
}>(), {
  align: 'start',
  iconOnly: false,
})

const disclosure = useTemplateRef('disclosure')
const trigger = useTemplateRef('trigger')

function close() {
  if (disclosure.value)
    disclosure.value.open = false
}

function select() {
  close()
  trigger.value?.focus()
}

function escape(event: KeyboardEvent) {
  if (!disclosure.value?.open)
    return

  event.preventDefault()
  event.stopPropagation()
  select()
}

function onFocusOut(event: FocusEvent) {
  if (event.relatedTarget instanceof Node && !disclosure.value?.contains(event.relatedTarget))
    close()
}

onClickOutside(disclosure, close)
</script>

<template>
  <details ref="disclosure" class="group relative" @keydown.esc="escape" @focusout="onFocusOut">
    <summary
      ref="trigger"
      data-slot="button"
      :aria-label="label"
      :title="iconOnly ? label : undefined"
      class="header-disclosure__trigger inline-flex min-h-11 cursor-pointer list-none items-center rounded-[var(--ylf-radius-sm)] text-sm font-medium text-[var(--ylf-c-text-2)] transition-colors hover:bg-[var(--ylf-c-bg-soft)] hover:text-foreground group-open:bg-[var(--ylf-c-bg-soft)] group-open:text-foreground"
      :class="iconOnly ? 'min-w-11 justify-center' : 'gap-2 px-3'"
    >
      <slot name="trigger" />
    </summary>

    <div
      class="absolute top-full z-10 mt-2 max-h-[calc(100dvh-5rem)] min-w-36 overflow-y-auto border p-1.5"
      :class="[menuSurface, align === 'start' ? 'start-0' : 'end-0']"
    >
      <slot :select="select" :trigger="trigger" />
    </div>
  </details>
</template>

<style scoped>
.header-disclosure__trigger::-webkit-details-marker {
  display: none;
}

.header-disclosure__trigger:focus-visible {
  outline: 2px solid var(--ylf-c-brand);
  outline-offset: -2px;
}
</style>
